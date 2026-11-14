import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, subSeed } from './rng.js';
import { cemProposer, fromUnit, MIN_SPREAD, runSearch, toUnit } from './cem.js';
import { DEFAULT_PARAMS, PARAM_NAMES, PARAM_SPECS, validateParams } from
  '../../../packages/games/action/bot-learned.js';

test('the rng is seeded, deterministic and roughly normal without transcendental functions', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const first = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(Array.from({ length: 5 }, () => b.next()), first);
  assert.notDeepEqual(Array.from({ length: 5 }, () => c.next()), first);
  const rng = makeRng(7);
  const draws = Array.from({ length: 20000 }, () => rng.normal());
  const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
  const variance = draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length;
  assert.ok(Math.abs(mean) < 0.03 && Math.abs(variance - 1) < 0.05, `${mean} ${variance}`);
  assert.ok(draws.every(x => x >= -6 && x <= 6));
  const u = makeRng(9);
  assert.ok(Array.from({ length: 1000 }, () => u.uniform()).every(x => x >= 0 && x < 1));
  assert.ok(Array.from({ length: 1000 }, () => u.int(7)).every(x => Number.isInteger(x) && x >= 0 && x < 7));
  for (const bad of [0, -1, 1.5, 2 ** 32, '1']) assert.throws(() => makeRng(bad), /INVALID_SCHEMA/);
  assert.notEqual(subSeed(5, 1), subSeed(5, 2));
  assert.equal(subSeed(5, 1), subSeed(5, 1));
});

test('unit space round trips and stays inside every range', () => {
  for (const name of PARAM_NAMES) {
    const { min, max } = PARAM_SPECS[name];
    assert.equal(fromUnit(name, 0), min);
    assert.equal(fromUnit(name, 1), max);
    assert.equal(fromUnit(name, -5), min);
    assert.equal(fromUnit(name, 9), max);
    for (const value of [min, Math.round((min + max) / 2), max]) {
      assert.equal(fromUnit(name, toUnit(name, value)), value);
    }
  }
});

// A synthetic fitness: the closer the vector is to a hidden target (in unit space), the better.
const TARGET = { standOff: 1500, reaction: 2, guardChance: 95, meleeClose: 1200, aggression: 100, aimBias: 120,
  strafePeriod: 20 };
const distance = params => Math.sqrt(PARAM_NAMES.reduce((s, n) =>
  s + (toUnit(n, params[n]) - toUnit(n, TARGET[n])) ** 2, 0));
const evaluate = async list => list.map(p => 1 - distance(p));

test('CEM improves a synthetic fitness, never does worse than its start, and is deterministic', async () => {
  const run = seed => runSearch({ proposer: cemProposer({ seed, start: DEFAULT_PARAMS }), evaluate, generations: 10,
    population: 16, start: DEFAULT_PARAMS });
  const first = await run(11);
  assert.equal(first.curve.length, 10);
  assert.equal(first.evaluated, 160);
  assert.ok(first.bestFitness > 1 - distance(DEFAULT_PARAMS), 'better than the start');
  assert.ok(first.curve.at(-1).mean > first.curve[0].mean, 'the population mean rises');
  assert.ok(first.curve.at(-1).eliteMean >= first.curve[0].eliteMean);
  assert.doesNotThrow(() => validateParams(first.best));
  for (const row of first.curve) assert.ok(row.best >= row.eliteMean && row.eliteMean >= row.mean);
  const again = await run(11);
  assert.deepEqual(again, first); // same seed, same search
  const other = await run(12);
  assert.notDeepEqual(other.curve, first.curve);
  assert.ok(first.curve[0].best >= 1 - distance(DEFAULT_PARAMS) - 1e-12); // generation 0 includes the start itself
});

test('the proposer keeps a spread floor and refits towards the elite', async () => {
  const proposer = cemProposer({ seed: 3, start: DEFAULT_PARAMS });
  const before = proposer.state();
  const scored = proposer.propose({ generation: 0, count: 16 })
    .map(params => ({ params, fitness: 1 - distance(params) }));
  proposer.update({ generation: 0, scored });
  const after = proposer.state();
  assert.ok(PARAM_NAMES.some(n => after.mean[n] !== before.mean[n]));
  for (let i = 0; i < 30; i++) {
    const list = proposer.propose({ generation: i + 1, count: 16 }).map(params => ({ params, fitness: 1 }));
    // every elite is the same vector: the deviation would collapse to zero without the floor
    proposer.update({ generation: i + 1, scored: list.map(e => ({ ...e, params: DEFAULT_PARAMS })) });
  }
  for (const n of PARAM_NAMES) assert.ok(proposer.state().deviation[n] >= MIN_SPREAD);
});

test('a bad proposal cannot crash a run: invalid fields take the best-so-far value and are counted', async () => {
  let call = 0;
  const wild = { origin: 'fake', propose: () => (call++ === 0
    ? [{ ...DEFAULT_PARAMS, standOff: 3000 }, { ...DEFAULT_PARAMS, standOff: 3000, reaction: 99 }, null, { bogus: 1 }]
    : [{ standOff: -1, reaction: 5 }, 'x', 7, { ...DEFAULT_PARAMS, aggression: 'high' }]), update() {} };
  const scoreByStandOff = async list => list.map(p => p.standOff / 6000);
  const out = await runSearch({ proposer: wild, evaluate: scoreByStandOff, generations: 2, population: 4,
    start: DEFAULT_PARAMS });
  assert.doesNotThrow(() => validateParams(out.best));
  assert.equal(out.best.standOff, 3000);
  assert.ok(out.curve[0].fellBack >= 3 && out.curve[1].fellBack === 4);
  // generation 2 falls back to the parent (the best of generation 1), not to the defaults
  assert.equal(out.curve.length, 2);
});

test('a broken evaluator result is refused', async () => {
  const proposer = cemProposer({ seed: 1, start: DEFAULT_PARAMS });
  for (const bad of [async () => [1], async () => [NaN, 1, 1, 1], async () => 'x']) {
    await assert.rejects(runSearch({ proposer, evaluate: bad, generations: 1, population: 4, start: DEFAULT_PARAMS }),
      /INVALID_SCHEMA/);
  }
});
