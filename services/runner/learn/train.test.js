import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as arena from '../../../packages/games/action/index.js';
import { hash } from '../../../packages/contracts/index.js';
import { DEFAULT_PARAMS, validateParams } from '../../../packages/games/action/bot-learned.js';
import { assertDisjoint, evaluateVector, HELD_OUT_SEED_BASE, measureMatchup, playMatch, scoreFor, scriptedBot,
  seedRange, TRAIN_SEED_BASE } from './evaluate.js';
import { evaluateMany } from './parallel.js';
import { heldOutEvaluation, trainHero, trainRoster } from './train.js';
import { wilson95 } from './stats.js';
// Tiny budgets only: a few short matches. The real training is a separate, long run.
const TICKS = 120;

test('playMatch and the score: deterministic, a draw at the tick limit is half a point', () => {
  const heroes = { p1: 'bari', p2: 'daewi' };
  const bots = { p1: scriptedBot, p2: scriptedBot };
  const a = playMatch({ heroes, bots, seed: 3, maxTicks: TICKS });
  assert.deepEqual(playMatch({ heroes, bots, seed: 3, maxTicks: TICKS }), a);
  assert.ok(a.ticks <= TICKS);
  assert.equal(scoreFor({ winner: null }, 'p1'), 0.5);
  assert.equal(scoreFor({ winner: 'p1' }, 'p1'), 1);
  assert.equal(scoreFor({ winner: 'p2' }, 'p1'), 0);
});

test('evaluateVector is deterministic, within 0..1, and counts both seat orders', () => {
  const task = { hero: 'bari', params: DEFAULT_PARAMS, population: {}, opponents: ['daewi', 'sepia'], seeds: [1, 2],
    maxTicks: TICKS };
  const fitness = evaluateVector(task);
  assert.equal(evaluateVector(task), fitness);
  assert.ok(fitness >= 0 && fitness <= 1);
  assert.equal((fitness * 8) % 0.5, 0); // 2 opponents x 2 seeds x 2 seats = 8 games, scores in halves
  assert.equal(evaluateVector({ ...task, opponents: [] }), 0);
  // the parameters matter: a bot that never attacks loses to one that does (long enough matches to finish)
  const long = { ...task, opponents: ['daewi'], seeds: [1], maxTicks: 700 };
  const passive = evaluateVector({ ...long, params: { ...DEFAULT_PARAMS, aggression: 0 } });
  assert.ok(passive < evaluateVector(long), `${passive} < ${evaluateVector(long)}`);
});

test('evaluateMany keeps task order and gives the same results on one worker or two', async () => {
  const tasks = [0, 30, 60, 90].map(aggression => ({ hero: 'real_armor', params: { ...DEFAULT_PARAMS, aggression },
    population: {}, opponents: ['sepia'], seeds: [4], maxTicks: TICKS }));
  const single = await evaluateMany(tasks, { workers: 1 });
  assert.deepEqual(await evaluateMany(tasks, { workers: 2 }), single);
  assert.deepEqual(await evaluateMany(tasks, { workers: 3 }), single);
  await assert.rejects(evaluateMany(tasks, { workers: 0 }), /INVALID_SCHEMA/);
  await assert.rejects(evaluateMany('x'), /INVALID_SCHEMA/);
});

test('measureMatchup gives the first hero win rate with a Wilson interval over seeds and both seat orders', () => {
  const out = measureMatchup({ heroes: ['bari', 'real_armor'], botFor: () => scriptedBot, seeds: [1, 2, 3],
    maxTicks: 400 });
  assert.equal(out.games, 6);
  assert.equal(out.winRate, Math.round(out.wins / 6 * 1e6) / 1e6);
  assert.deepEqual(out.ci95, wilson95(out.wins, 6));
  assert.ok(out.ci95[0] <= out.winRate && out.winRate <= out.ci95[1]);
  assert.deepEqual(wilson95(0, 0), [0, 1]);
  assert.throws(() => wilson95(5, 4), /invalid wilson input/);
});

test('seed sets: training, evaluation and held-out never overlap, and an overlap is refused', () => {
  const train = seedRange(TRAIN_SEED_BASE, 1000);
  assert.doesNotThrow(() => assertDisjoint(train, seedRange(1, 100000)));
  assert.doesNotThrow(() => assertDisjoint(train, seedRange(HELD_OUT_SEED_BASE, 1000)));
  assert.throws(() => assertDisjoint([1, 2, 3], [3, 4]), /overlap/);
  assert.ok(TRAIN_SEED_BASE < HELD_OUT_SEED_BASE);
  assert.ok(TRAIN_SEED_BASE > 1_000_000 && HELD_OUT_SEED_BASE - TRAIN_SEED_BASE >= 1_000_000);
});

test('trainHero on a tiny budget: seeded, deterministic, valid parameters and a fitness curve', async () => {
  const options = { hero: 'bari', population: {}, opponents: ['daewi', 'sepia'], generations: 2, populationSize: 4,
    seedsPerOpponent: 1, seed: 5, maxTicks: TICKS };
  const first = await trainHero(options);
  assert.doesNotThrow(() => validateParams(first.params));
  assert.equal(first.curve.length, 2);
  assert.equal(first.evaluated, 8);
  assert.equal(first.matches, 8 * 2 * 1 * 2); // vectors x opponents x seeds x seat orders
  assert.equal(first.origin, 'cem');
  const again = await trainHero(options);
  assert.deepEqual({ ...again, ms: 0 }, { ...first, ms: 0 });
  const parallel = await trainHero({ ...options, workers: 2 });
  assert.deepEqual({ ...parallel, ms: 0 }, { ...first, ms: 0 }); // scheduling cannot change a result
  await assert.rejects(trainHero({ ...options, opponents: [] }), /INVALID_SCHEMA/);
  await assert.rejects(trainHero({ ...options, opponents: ['bari'] }), /INVALID_SCHEMA/);
});

test('trainRoster: Nightcrow is held out, files carry the honesty fields and a held-out evaluation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'learned-'));
  try {
    const run = await trainRoster({ heroes: ['bari', 'daewi'], heldOut: ['nightcrow'], generations: 1,
      populationSize: 3, seedsPerOpponent: 1, heldOutPairs: 2, seed: 9, workers: 1, maxTicks: TICKS, outDir: dir,
      now: () => '2026-11-14T12:00:00.000Z' });
    assert.deepEqual(Object.keys(run.files), ['bari', 'daewi']);
    for (const hero of ['bari', 'daewi']) {
      const file = JSON.parse(readFileSync(join(dir, `${hero}.json`), 'utf8'));
      assert.deepEqual(file, JSON.parse(JSON.stringify(run.files[hero])));
      assert.equal(file.policy, 'learned-cem-1');
      assert.equal(file.hero, hero);
      assert.doesNotThrow(() => validateParams(file.params));
      assert.deepEqual(file.trainedOn.heldOut, ['nightcrow']);
      assert.ok(!file.trainedOn.opponents.includes('nightcrow') && !file.trainedOn.opponents.includes(hero));
      assert.equal(file.trainedOn.dataHash, hash(arena.data));
      assert.equal(file.trainedOn.simVersion, arena.simVersion);
      assert.equal(file.trainedOn.seeds.first, TRAIN_SEED_BASE);
      assert.match(file.trainedOn.seeds.evaluationSeedsExcluded, /^1\.\.1000 and 7000001\.\.7000002$/);
      assert.equal(file.fitness.length, 1);
      assert.equal(file.createdAt, '2026-11-14T12:00:00.000Z');
      const [held] = file.heldOutEval;
      assert.equal(held.opponent, 'nightcrow');
      assert.deepEqual(held.seeds, { first: HELD_OUT_SEED_BASE, count: 2 });
      for (const row of ['learned', 'defaults', 'scripted']) assert.equal(held[row].games, 4);
    }
    // the second hero was trained against the first one's learned parameters
    assert.deepEqual(run.population.bari, run.files.bari.params);
    assert.ok(run.files.daewi.trainedOn.opponents.includes('bari'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trainRoster refuses a held-out hero in the training list, unknown heroes and overlapping seeds', async () => {
  await assert.rejects(trainRoster({ heroes: ['bari', 'nightcrow'], heldOut: ['nightcrow'], generations: 1 }),
    /INVALID_SCHEMA/);
  await assert.rejects(trainRoster({ heroes: ['nobody'], generations: 1 }), /INVALID_SCHEMA/);
  await assert.rejects(trainRoster({ heroes: ['bari'], heldOut: ['nobody'], generations: 1 }), /INVALID_SCHEMA/);
  await assert.rejects(trainRoster({ heroes: ['bari'], generations: 1, seedsPerOpponent: 5_000_000 }), /overlap/);
});

test('heldOutEvaluation compares trained, default and scripted parameters on the same held-out seeds', () => {
  const out = heldOutEvaluation({ hero: 'sepia', heldOutHero: 'nightcrow', params: DEFAULT_PARAMS, population: {},
    pairs: 2, maxTicks: TICKS });
  assert.equal(out.learned.games, 4);
  assert.deepEqual(out.seeds, { first: HELD_OUT_SEED_BASE, count: 2 });
  // with the default parameters as the "trained" ones the learned and default rows are the same experiment
  assert.deepEqual(out.learned, out.defaults);
});
