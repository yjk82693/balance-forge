// Trains per-hero bot parameters by self-play with the cross-entropy method (or another proposer behind the same
// interface), holds some heroes out of training, and writes services/runner/learned/<hero>.json.
//
//   node services/runner/learn/train.js [--generations 10] [--population 16] [--seeds-per-opponent 5] [--workers 2]
//     [--held-out nightcrow] [--heroes bari,daewi,real_armor,sepia] [--seed 1] [--out services/runner/learned]
//
// Honesty rules (also written into every output file): the training seeds (5,000,001..) are disjoint from the
// evaluation seeds (1..N) and from the held-out seeds (7,000,001..); a held-out hero is never an opponent in
// training; the opponents' parameters are the population's current ones (the scripted 0.2.1 policy until a hero
// has been trained).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as arena from '../../../packages/games/action/index.ts';
import { hash } from '../../../packages/contracts/index.ts';
import { DEFAULT_PARAMS, makeLearnedBot, POLICY_ID, validateParams } from
  '../../../packages/games/action/bot-learned.ts';
import { cemProposer, runSearch } from './cem.ts';
import { evaluateMany } from './parallel.ts';
import { assertDisjoint, HELD_OUT_SEED_BASE, MAX_TICKS, measureMatchup, scriptedBot, seedRange,
  TRAIN_SEED_BASE } from './evaluate.ts';

export const DEFAULTS = Object.freeze({ generations: 10, population: 16, seedsPerOpponent: 5, heldOutPairs: 100,
  workers: 2, seed: 1, maxTicks: MAX_TICKS });

const allHeroes = () => arena.data.characters.map(c => c.id);

/** Trains one hero against the opponents' current parameters. Resolves { params, curve, evaluated, matches, ms }. */
export async function trainHero({ hero, population = {}, opponents, generations, populationSize, seedsPerOpponent,
  seed, makeProposer = cemProposer, workers = 1, maxTicks = MAX_TICKS }) {
  if (!opponents.length || opponents.includes(hero)) throw Error('INVALID_SCHEMA');
  const trainSeeds = seedRange(TRAIN_SEED_BASE, seedsPerOpponent);
  const started = performance.now();
  const proposer = makeProposer({ seed, start: DEFAULT_PARAMS, hero });
  const search = await runSearch({ proposer, generations, population: populationSize, start: DEFAULT_PARAMS,
    evaluate: list => evaluateMany(list.map(params => ({ hero, params, population, opponents, seeds: trainSeeds,
      maxTicks })), { workers }) });
  const perVector = opponents.length * seedsPerOpponent * 2;
  return { hero, params: search.best, bestFitness: search.bestFitness, curve: search.curve,
    evaluated: search.evaluated, matches: search.evaluated * perVector, origin: proposer.origin,
    ms: Math.round(performance.now() - started) };
}

/** Held-out measurement: the trained hero (learned) against a hero that was never a training opponent. */
export function heldOutEvaluation({ hero, heldOutHero, params, population, pairs, maxTicks = MAX_TICKS }) {
  const seeds = seedRange(HELD_OUT_SEED_BASE, pairs);
  const learned = makeLearnedBot({ ...population, [hero]: params });
  const defaults = makeLearnedBot({ [hero]: DEFAULT_PARAMS });
  const measure = botFor => measureMatchup({ heroes: [hero, heldOutHero], botFor, seeds, maxTicks });
  return { opponent: heldOutHero, seeds: { first: HELD_OUT_SEED_BASE, count: pairs },
    learned: measure(h => (h === hero ? learned : scriptedBot)),
    defaults: measure(h => (h === hero ? defaults : scriptedBot)),
    scripted: measure(() => scriptedBot) };
}

/**
 * Trains `heroes` one after another (each against the others' current parameters), then runs the held-out
 * evaluation and writes one file per hero into `outDir` (when given). Resolves { files, results, population }.
 */
export async function trainRoster({ heroes = allHeroes().filter(h => h !== 'nightcrow'), heldOut = ['nightcrow'],
  generations = DEFAULTS.generations, populationSize = DEFAULTS.population,
  seedsPerOpponent = DEFAULTS.seedsPerOpponent, heldOutPairs = DEFAULTS.heldOutPairs, seed = DEFAULTS.seed,
  workers = DEFAULTS.workers, maxTicks = MAX_TICKS, makeProposer = cemProposer, outDir,
  now = () => new Date().toISOString(), onHero } = {}) {
  const roster = allHeroes();
  if (heroes.some(h => !roster.includes(h) || heldOut.includes(h)) || heldOut.some(h => !roster.includes(h))) {
    throw Error('INVALID_SCHEMA');
  }
  const trainSeeds = seedRange(TRAIN_SEED_BASE, seedsPerOpponent);
  assertDisjoint(trainSeeds, seedRange(1, Math.max(heldOutPairs, 1000)), 'training and evaluation seeds');
  assertDisjoint(trainSeeds, seedRange(HELD_OUT_SEED_BASE, heldOutPairs), 'training and held-out seeds');
  const opponentsOf = hero => roster.filter(h => h !== hero && !heldOut.includes(h));
  const population = {};
  const results = [];
  for (const hero of heroes) {
    const trained = await trainHero({ hero, population, opponents: opponentsOf(hero), generations, populationSize,
      seedsPerOpponent, seed: seed + results.length, makeProposer, workers, maxTicks });
    validateParams(trained.params);
    population[hero] = trained.params;
    results.push(trained);
    onHero?.(trained);
  }
  const dataHash = hash(arena.data);
  const files = {};
  for (const trained of results) {
    const heldOutEval = heldOut.map(opponent => heldOutEvaluation({ hero: trained.hero, heldOutHero: opponent,
      params: trained.params, population, pairs: heldOutPairs, maxTicks }));
    files[trained.hero] = { policy: POLICY_ID, hero: trained.hero, params: trained.params,
      trainedOn: { seeds: { first: TRAIN_SEED_BASE, perOpponent: seedsPerOpponent,
        evaluationSeedsExcluded: `1..1000 and ${HELD_OUT_SEED_BASE}..${HELD_OUT_SEED_BASE + heldOutPairs - 1}` },
      generations, population: populationSize,
      opponents: opponentsOf(trained.hero), heldOut, opponentParams: 'the population current at training time '
        + '(scripted 0.2.1 until that hero was trained)', dataHash, simVersion: arena.simVersion,
      proposer: { origin: trained.origin, seed: seed + results.indexOf(trained) }, matches: trained.matches },
    fitness: trained.curve, bestFitness: trained.bestFitness, heldOutEval, trainingMs: trained.ms, createdAt: now() };
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    for (const [hero, file] of Object.entries(files)) writeFileSync(join(outDir, `${hero}.json`),
      `${JSON.stringify(file, null, 2)}\n`);
  }
  return { files, results, population };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = {};
  for (let i = 2; i < process.argv.length; i += 2) flags[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const number = (name, fallback) => (flags[name] === undefined ? fallback : Number(flags[name]));
  const outDir = flags.out ?? fileURLToPath(new URL('../learned', import.meta.url));
  try {
    const run = await trainRoster({ generations: number('generations', DEFAULTS.generations),
      populationSize: number('population', DEFAULTS.population),
      seedsPerOpponent: number('seeds-per-opponent', DEFAULTS.seedsPerOpponent),
      heldOutPairs: number('held-out-pairs', DEFAULTS.heldOutPairs), workers: number('workers', DEFAULTS.workers),
      seed: number('seed', DEFAULTS.seed), ...(flags.heroes ? { heroes: flags.heroes.split(',') } : {}),
      ...(flags['held-out'] ? { heldOut: flags['held-out'].split(',') } : {}), outDir,
      onHero: t => console.error(`trained ${t.hero}: best ${t.bestFitness.toFixed(3)} in ${t.ms} ms `
        + `(${t.matches} matches)`) });
    console.log(JSON.stringify({ ok: true, outDir, heroes: Object.keys(run.files) }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error.message).slice(0, 200) }));
    process.exitCode = 1;
  }
}
