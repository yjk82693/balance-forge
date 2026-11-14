import test from 'node:test';
import assert from 'node:assert/strict';
import { FakePatchAdapter } from '../src/index.ts';
import { runFull } from '../pipeline/full.ts';
import { reanalyzeRun } from '../pipeline/reanalyze.ts';
import { pairedResults } from './helpers.ts';

const BASE_HASH = 'a'.repeat(64);
const PATCHED_HASH = 'c'.repeat(64);
const baseData = { moves: [{ id: 'melee', power: 50 }, { id: 'spirit_arrow', power: 92 }], tuning: {} };
const hashData = (d) => (d.moves[1].power === 92 ? BASE_HASH : PATCHED_HASH);
const rate = (r) => (seed) => (seed % 100 < r * 100 ? 'a' : 'b');
const games = (r, extra = {}) =>
  pairedResults({ heroes: ['bari', 'real_armor'], seeds: 200, winner: rate(r), ...extra });
const holdout = (r) => games(r, { dataHash: PATCHED_HASH }).map((m) => ({ ...m, config: { ...m.config,
  seed: 10000 + m.config.seed } }));
const CLEAR = { version: 'v1', matchups: { 'bari vs real_armor': { favored: 'bari', strength: 'clear' } } };
const proposal = { baseDataHash: BASE_HASH, replacements: [{ path: '/moves/1/power', value: 72 }], rationale: 'x' };
const freshInput = (r, h, extra = {}) => ({ baselineResults: games(r), baseData, hashData,
  holdoutSeeds: Array.from({ length: 200 }, (_, i) => 10001 + i), adapter: new FakePatchAdapter(proposal),
  runHoldout: async () => holdout(h), ...extra });
const again = (stored, r, h, intent, extra = {}) => reanalyzeRun({ stored, baselineResults: games(r),
  holdoutResults: h === null ? null : holdout(h), baseData, hashData, intent, ...extra });
const withoutFlag = ({ reanalyzed, ...rest }) => rest;

test('reanalyze gives exactly what a fresh run gives on the same results under the new intent', async () => {
  const original = (await runFull(freshInput(0.8, 0.62))).value; // run under no intent
  for (const [baseRate, holdoutRate] of [[0.8, 0.62], [0.8, 0.5], [0.72, 0.8]]) {
    const stored = (await runFull(freshInput(baseRate, holdoutRate))).value;
    const fresh = (await runFull(freshInput(baseRate, holdoutRate, { intent: CLEAR }))).value;
    const re = await reanalyzeRun({ stored, baselineResults: games(baseRate), holdoutResults: holdout(holdoutRate),
      baseData, hashData, intent: CLEAR });
    assert.equal(re.ok, true, JSON.stringify(re));
    assert.deepEqual(withoutFlag(re.value), fresh, `${baseRate} -> ${holdoutRate}`);
    assert.equal(re.value.reanalyzed, true);
  }
  assert.equal(original.baseline.rows[0].target, undefined); // the original run had no targets: reanalyze added them
});

test('the verdict follows the intent: 80% -> 62% is toward a 60% target, and also toward a 35% one', async () => {
  const stored = (await runFull(freshInput(0.8, 0.62))).value;
  const even = await again(stored, 0.8, 0.62, { version: 'e', matchups: {} });
  assert.equal(even.value.verdict.verdict, 'accepted');
  const cleared = await again(stored, 0.8, 0.62, CLEAR);
  assert.equal(cleared.value.verdict.verdict, 'accepted');
  assert.equal(cleared.value.verdict.targets[0].after.rate, 0.62);
  // the other hero favored "strongly": Bari's target is 35%, so 80% is 45 points over it and 62% is 27 over
  const flipped = await again(stored, 0.8, 0.62, { version: 'f', matchups: {
    'bari vs real_armor': { favored: 'real_armor', strength: 'strong' } } }); // bari's target is 35%
  assert.equal(flipped.value.verdict.targets[0].before.rate, 0.8);
  assert.equal(flipped.value.baseline.rows[0].target, 0.35);
  assert.equal(flipped.value.baseline.rows[0].deltaToTarget, 0.45);
  assert.equal(flipped.value.verdict.verdict, 'accepted'); // 18 points closer to its target
});

test('an intended matchup becomes fair on reanalysis: no proposal is kept in the body, like a fresh run', async () => {
  const stored = (await runFull(freshInput(0.6, 0.6))).value; // 60% is flagged against an even target
  assert.equal(stored.fair, false);
  const re = await again(stored, 0.6, 0.6, CLEAR);
  assert.equal(re.value.fair, true);
  assert.equal(re.value.proposal, null);
  assert.equal(re.value.intentVersion, 'v1');
  const fresh = (await runFull(freshInput(0.6, 0.6, { intent: CLEAR }))).value;
  assert.deepEqual(withoutFlag(re.value), fresh);
});

test('a run that stopped at its baseline cannot be judged when the new intent flags it: it says so', async () => {
  const stored = (await runFull(freshInput(0.5, 0.5))).value;
  assert.equal(stored.fair, true);
  const same = await again(stored, 0.5, null, { version: 'e', matchups: {} });
  assert.equal(same.value.fair, true); // still fair under an even intent
  const re = await again(stored, 0.5, null, CLEAR); // 50% against an intended 60%: 10 points short
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal(re.value.stale, true);
  assert.equal(re.value.fair, false);
  assert.equal(re.value.verdict.verdict, 'inconclusive');
  assert.match(re.value.verdict.reasons[0], /run it again/);
  assert.equal(re.value.baseline.rows[0].deltaToTarget, -0.1);
  assert.equal(re.value.proposal, null);
});

test('reanalyze is fast and refuses bad input with coded errors', async () => {
  const stored = (await runFull(freshInput(0.8, 0.62))).value;
  const start = performance.now();
  for (let i = 0; i < 5; i++) assert.equal((await again(stored, 0.8, 0.62, CLEAR)).ok, true);
  assert.ok((performance.now() - start) / 5 < 500, 'well under a second per reanalysis');
  assert.equal((await reanalyzeRun({ stored: null, baselineResults: games(0.8), baseData, hashData })).error.code,
    'INVALID_INPUT');
  assert.equal((await reanalyzeRun({ stored, baselineResults: [], baseData, hashData })).error.code, 'NO_RESULTS');
  assert.equal((await reanalyzeRun(undefined)).ok, false);
  assert.equal((await again(stored, 0.8, 0.62, { version: '' })).error.code, 'INVALID_INPUT');
});
