// Fits the human-style bot (policy cloned-lr-1) from recorded human Hero Arena matches and writes the model file.
//   node services/runner/learn/train-human.ts --results <human-results.json> --replays <dir> [--data <dir>]
//     [--out services/runner/learned/human-style.json] [--seed 1] [--test-share 0.3] [--steps 200]
// It only READS the paths it is given: pass COPIES of the room storage (never the live folder). A match is used when
// it is a finished Hero Arena match with a recording whose re-simulation reproduces the recorded final state hash
// (a recording that does not is listed in `excluded` with the reason, never used half-way). The decisions of each
// human seat are rebuilt by re-simulating the recorded input frames; the other seat is never trained on when it was a
// bot. The split into training and test data is BY MATCH (all ticks of a match go to one side).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as arena from '../../../packages/games/action/index.ts';
import { hash } from '../../../packages/contracts/index.ts';
import { replayOnData } from '../../../packages/sim/index.ts';
import { buildModel, CLASSES, datasetFromRecording, evaluateModel, MIN_MATCHES, readiness, trainLogistic }
  from './clone.ts';
import { makeRng } from './rng.ts';
import { round6 } from './stats.ts';

export const CAVEATS = [
  'Fitted on a handful of matches from very few players, mostly one person playing Real Armor against the room bot.',
  'Many of the matches are short losses against the bot, so the cloned style is that of someone being beaten.',
  'It describes this data only. It is a style for a bot to play, not a measure of balance: no balance number may',
  'use it.'
];

/** Which data version a recording was played on: the built-in data, or a copy of a retained one from `dataDir`. */
function dataFor(config, dataDir) {
  if (hash(arena.data) === config.dataHash) return arena.data;
  const path = dataDir ? join(dataDir, `${config.dataHash}.json`) : null;
  if (path && existsSync(path)) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (hash(data) === config.dataHash) return data;
  }
  return null;
}

/** Loads the usable matches: [{ matchId, seats, recording, data }] and the excluded ones with their reasons. */
export function loadMatches({ results, replaysDir, dataDir }: {
  results: any[]; replaysDir: string; dataDir?: string }) {
  const used = [], excluded = [];
  for (const result of results) {
    const id = result.matchId;
    const skip = reason => excluded.push({ matchId: id, reason });
    if (result.config?.gameId !== 'hero_arena') continue; // another game: not part of this model at all
    if (result.valid !== true || result.outcome?.status === 'running') {
      skip('not a finished valid match');
      continue;
    }
    const path = join(replaysDir, `${id}.json`);
    if (!existsSync(path)) {
      skip('no recording');
      continue;
    }
    const recording = JSON.parse(readFileSync(path, 'utf8'));
    const data = dataFor(recording.config, dataDir);
    if (!data) {
      skip('data version not available');
      continue;
    }
    // Recordings made under an older simulation version are replayed under the current one and kept only if the
    // final state hash still matches the recorded result.
    const config = { ...structuredClone(recording.config), simVersion: arena.simVersion };
    let reproduced = false;
    try {
      reproduced = hash(replayOnData(arena.adapter, { ...recording, config }, data)) === result.finalStateHash;
    } catch {
      reproduced = false;
    }
    if (!reproduced) {
      skip(`re-simulation does not reproduce the recorded final state (recorded under ${recording.config.simVersion})`);
      continue;
    }
    const bots = new Set(result.botSeats ?? []);
    used.push({ matchId: id, recording: { ...recording, config }, data, simVersion: recording.config.simVersion,
      seats: result.config.players.filter(seat => !bots.has(seat)), outcome: result.outcome.status });
  }
  return { used, excluded };
}

const rowsOf = matches => matches.flatMap(match => match.seats.flatMap(seat =>
  datasetFromRecording(match.recording, seat, match.data).rows));

/** A seeded shuffle of the matches (Fisher-Yates), so the split by match is reproducible. */
function shuffled(list, seed) {
  const rng = makeRng(seed), out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const majorityClass = rows => {
  const counts = new Array(CLASSES.length).fill(0);
  for (const { y } of rows) counts[y]++;
  return counts.indexOf(Math.max(...counts));
};
/** Accuracy of always guessing `cls`: the number a model has to beat. */
const baselineAccuracy = (cls, rows) => round6(rows.filter(r => r.y === cls).length / (rows.length || 1));

/** Fits on `train` matches, scores on `test` matches. */
function fit(train, test, { seed, steps }) {
  const trainRows = rowsOf(train), testRows = rowsOf(test);
  const weights = trainLogistic(trainRows, { seed, steps });
  const majority = majorityClass(trainRows);
  return { weights, trainRows, testRows,
    training: evaluateModel(weights, trainRows),
    test: { ...evaluateModel(weights, testRows), baselineAccuracy: baselineAccuracy(majority, testRows),
      baselineClass: CLASSES[majority], matches: test.length } };
}

export function trainHumanStyle({ results, replaysDir, dataDir, seed = 1, testShare = 0.3, steps = 200, folds = 5,
  createdAt = new Date().toISOString() }: { results: any[]; replaysDir: string; dataDir?: string; seed?: number;
  testShare?: number; steps?: number; folds?: number; createdAt?: string }) {
  const { used, excluded } = loadMatches({ results, replaysDir, dataDir });
  if (used.length < 4) throw Error(`only ${used.length} usable matches: no model is trained`);
  const order = shuffled(used, seed);
  const testCount = Math.max(2, Math.round(order.length * testShare));
  const test = order.slice(0, testCount), train = order.slice(testCount);
  const main = fit(train, test, { seed, steps });
  // Match-wise cross-validation: the same question asked on every part of the data once.
  const cv = [];
  for (let k = 0; k < Math.min(folds, used.length); k++) {
    const part = order.filter((_, i) => i % folds === k);
    cv.push(fit(order.filter(m => !part.includes(m)), part, { seed, steps }).test);
  }
  const mean = key => round6(cv.reduce((s, f) => s + f[key] * f.rows, 0) / cv.reduce((s, f) => s + f.rows, 0));
  const model = buildModel({ weights: main.weights, rows: main.trainRows.length, matches: used.length, seed,
    trainingAccuracy: main.training.accuracy, heldOutAccuracy: main.test.accuracy,
    dataHash: hash(used.map(m => m.recording.config.dataHash).sort()), createdAt });
  const allRows = rowsOf(used);
  const ready = readiness(used.length);
  return { ...model,
    readiness: ready.ready ? ready : { ...ready,
      note: `${used.length} usable matches, below the ${MIN_MATCHES} asked for: `
        + 'fitted anyway as an exploratory style; nothing is claimed beyond the numbers in this file' },
    trainedOn: { ...model.trainedOn,
      matches: used.length, matchesUsed: used.length, matchesTrain: train.length, matchesTest: test.length,
      ticks: used.reduce((s, m) => s + m.recording.frames.length, 0), rows: main.trainRows.length,
      humanSeats: used.reduce((s, m) => s + m.seats.length, 0),
      byOutcome: Object.fromEntries([...new Set(used.map(m => m.outcome))].map(o =>
        [o, used.filter(m => m.outcome === o).length])),
      simVersions: [...new Set(used.map(m => m.simVersion))].sort(), seedUsed: seed, split: 'by match',
      testMatchIds: test.map(m => m.matchId).sort(), excluded },
    accuracy: { training: main.training.accuracy,
      heldOut: main.test,
      crossValidation: { folds: cv.length, accuracy: mean('accuracy'), baselineAccuracy: mean('baselineAccuracy'),
        perFold: cv.map(f => ({ matches: f.matches, rows: f.rows, accuracy: f.accuracy,
          baselineAccuracy: f.baselineAccuracy })) },
      classShare: Object.fromEntries(CLASSES.map((name, c) => [name, round6(allRows.filter(r => r.y === c).length /
        allRows.length)]).filter(([, share]) => (share as number) > 0)) },
    caveats: CAVEATS };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) flags[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  if (!flags.results || !flags.replays) {
    throw Error('usage: --results <human-results.json> --replays <dir> [--data <dir>]');
  }
  const out = flags.out ?? fileURLToPath(new URL('../learned/human-style.json', import.meta.url));
  const model = trainHumanStyle({ results: JSON.parse(readFileSync(flags.results, 'utf8')), replaysDir: flags.replays,
    dataDir: flags.data, seed: flags.seed ? Number(flags.seed) : 1, testShare: flags['test-share'] ?
      Number(flags['test-share']) : 0.3, steps: flags.steps ? Number(flags.steps) : 200 });
  writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`);
  console.log(JSON.stringify({ out, matches: model.trainedOn.matchesUsed, excluded: model.trainedOn.excluded.length,
    rows: model.trainedOn.rows, accuracy: model.accuracy.heldOut, cv: model.accuracy.crossValidation }));
}
