import test from 'node:test';
import assert from 'node:assert/strict';
import { runFull } from '../pipeline/full.js';
import { FakePatchAdapter } from '../src/index.js';
import { pairedResults } from './helpers.js';

const BASE_HASH = 'a'.repeat(64);
const PATCHED_HASH = 'c'.repeat(64);
const baseData = { moves: [{ id: 'melee', power: 50 }, { id: 'spirit_arrow', power: 92 }],
  characters: [{ id: 'bari', moves: ['melee', 'spirit_arrow'] }], tuning: { damageScalePermille: 1000 } };
// Stand-in hash: the base data and the data after the fake patch (spirit arrow 72) get the two known hashes.
const hashData = (d) => (d.moves[1].power === 92 ? BASE_HASH : PATCHED_HASH);
const proposal = { baseDataHash: BASE_HASH, replacements: [{ path: '/moves/1/power', value: 72 }],
  rationale: 'lower spirit arrow' };
const rate = (r) => (seed) => (seed % 100 < r * 100 ? 'a' : 'b');
const baselineResults = pairedResults({ seeds: 100, winner: rate(0.79) });
const holdoutSeeds = Array.from({ length: 100 }, (_, i) => 1000 + i);
const holdoutOf = (r, hash = PATCHED_HASH) => pairedResults({ dataHash: hash, seeds: 100, winner: rate(r) })
  .map((m) => ({ ...m, config: { ...m.config, seed: m.config.seed + 999 } }));

const input = (extra = {}) => ({ baselineResults, baseData, hashData, holdoutSeeds,
  adapter: new FakePatchAdapter(proposal), runHoldout: async () => holdoutOf(0.54), ...extra });
const code = (o) => (o.ok ? 'ok' : o.error.code);

test('runFull: shared-interface body, with old values in proposal.changes', async () => {
  let seen;
  const out = await runFull(input({ humanResults: [], runHoldout: async (data, seeds) => {
    seen = { data, seeds };
    return holdoutOf(0.54);
  } }));
  assert.equal(out.ok, true, JSON.stringify(out));
  const b = out.value;
  assert.equal(seen.data.moves[1].power, 72);
  assert.deepEqual(seen.seeds, holdoutSeeds);
  assert.equal(b.baseline.dataHash, BASE_HASH);
  assert.equal(b.patched.dataHash, PATCHED_HASH);
  assert.equal(b.patchedDataHash, PATCHED_HASH);
  assert.equal(b.proposal.origin, 'fake');
  assert.deepEqual(b.proposal.changes, [{ path: '/moves/1/power', label: 'Bari · Spirit Arrow power', old: 92,
    new: 72 }]);
  assert.deepEqual(b.validation, { ok: true, errors: [] });
  assert.equal(b.verdict.verdict, 'accepted', b.verdict.reasons.join('; '));
  assert.equal(b.humanMatches, 0);
  assert.equal(b.botPolicyVersion, b.baseline.botPolicyVersion);
  assert.notEqual(b.holdoutSeedSetId, b.seedSetId);
  assert.equal(b.patched.seedSetId, b.holdoutSeedSetId);
});

test('runFull: a patch that makes things worse is rejected', async () => {
  const out = await runFull(input({ runHoldout: async () => holdoutOf(0.95) }));
  assert.equal(out.value.verdict.verdict, 'rejected');
});

test('runFull: human results add rows and humanMatches', async () => {
  const humans = pairedResults({ seeds: 3 }).slice(0, 5).map((r, i) => ({ ...r, matchId: `human-${i}` }));
  const out = await runFull(input({ humanResults: humans }));
  assert.equal(out.value.humanMatches, 5);
  assert.ok(out.value.baseline.rows.some((r) => r.dimension.startsWith('human: ')));
});

test('runFull: an invalid patch skips the holdout run and says so', async () => {
  let called = false;
  const bad = new FakePatchAdapter({ ...proposal, replacements: [{ path: '/moves/1/power', value: 99999 }] });
  const out = await runFull(input({ adapter: bad, runHoldout: async () => { called = true; return []; } }));
  assert.equal(called, false);
  assert.equal(out.value.validation.ok, false);
  assert.equal(out.value.patched, null);
  assert.equal(out.value.patchedDataHash, null);
  assert.equal(out.value.verdict.verdict, 'inconclusive');
  assert.deepEqual(out.value.proposal.changes, []);
});

test('runFull: bad input becomes clear error results, never a throw', async () => {
  assert.equal(code(await runFull(undefined)), 'INVALID_INPUT');
  assert.equal(code(await runFull(input({ baselineResults: [] }))), 'NO_RESULTS');
  assert.equal(code(await runFull(input({ runHoldout: undefined }))), 'INVALID_INPUT');
  assert.equal(code(await runFull(input({ holdoutSeeds: [] }))), 'INVALID_INPUT');
  assert.equal(code(await runFull(input({ holdoutSeeds: [1, 2, 3] }))), 'INVALID_INPUT'); // overlaps baseline
  assert.equal(code(await runFull(input({ runHoldout: async () => { throw new Error('boom'); } }))),
    'SIMULATION_FAILED');
  assert.equal(code(await runFull(input({ runHoldout: async () => [] }))), 'NO_RESULTS');
  assert.equal(code(await runFull(input({ runHoldout: async () => holdoutOf(0.54, 'd'.repeat(64)) }))),
    'DATA_HASH_MISMATCH');
  assert.equal(code(await runFull(input({ runHoldout: async () => pairedResults({ dataHash: PATCHED_HASH,
    seeds: 100 }) }))), 'INVALID_INPUT'); // seeds 1..100 were not requested
  assert.equal(code(await runFull(input({ adapter: {} }))), 'INVALID_INPUT');
});
