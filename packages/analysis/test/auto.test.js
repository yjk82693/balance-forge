import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { baseVersionRecord, runAuto } from '../pipeline/auto.js';
import { pairedResults } from './helpers.js';

const ROSTER = ['bari vs bari', 'bari vs daewi', 'daewi vs real_armor', 'bari vs real_armor'];
const hashData = (d) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
const power = (d) => d.moves[1].power;

/** A stub world: versions by hash, a win-rate model per matchup and power, and an adapter that lowers move 1 by 20. */
function world(model, { step = 20, floor = 52 } = {}) {
  const store = new Map();
  const keep = (data) => { const dataHash = hashData(data); store.set(dataHash, data); return { data, dataHash }; };
  const base = keep({ moves: [{ id: 'a', power: 50 }, { id: 'b', power: 92 }], tuning: {} });
  const calls = [];
  const runBatch = async (dataHash, matchups, seeds) => {
    calls.push({ dataHash, matchups, seeds });
    const data = store.get(dataHash);
    return matchups.flatMap((dim) => {
      const [a, b] = dim.split(' vs ');
      const rate = model(dim, power(data));
      return pairedResults({ dataHash, heroes: [a, b], seeds: seeds.length,
        winner: (s) => (s % 100 < rate * 100 ? 'a' : 'b') })
        .map((r, i) => ({ ...r, matchId: `${dim}-${i}`, config: { ...r.config, seed: seeds[r.config.seed - 1] } }));
    });
  };
  const adapter = { async proposeWithOrigin(report) {
    const p = power(store.get(report.dataHash));
    return { origin: 'fake', proposal: { baseDataHash: report.dataHash, rationale: 'lower move b',
      replacements: [{ path: '/moves/1/power', value: Math.max(floor, p - step) }] } };
  } };
  const applyPatch = (data, proposal) => {
    if (proposal.baseDataHash !== hashData(data)) throw new Error('PATCH_REJECTED');
    const next = structuredClone(data);
    next.moves[1].power = proposal.replacements[0].value;
    return keep(next);
  };
  const seedsFor = (round, phase) => Array.from({ length: 100 }, (_, i) => (phase === 'scan' ? 1 : 1000001 +
    (round - 1) * 100) + i);
  const input = (extra = {}) => ({ gameId: 'hero_arena', fromHash: base.dataHash, data: base.data, adapter, hashData,
    applyPatch, runBatch, seedsFor, allMatchups: ROSTER, botPolicyVersion: 'scripted-test', seedSetId: 'scan-1-100',
    requireApproval: false, now: () => '2026-11-14T00:00:00.000Z', ...extra });
  return { store, base, keep, calls, input, runBatch };
}

// bari vs daewi: 80% at power 92, 65% at 72, 50% at 52. Everything else is fair.
const cleanModel = (dim, p) => (dim === 'bari vs daewi' ? 0.5 + ((p - 52) / 40) * 0.3 : 0.5);

test('clean run: two accepted rounds, a parent chain, then fair, and one final all-matchups check', async () => {
  const w = world(cleanModel);
  const records = [];
  const out = await runAuto(w.input({ rounds: 3, onRecord: (r) => records.push(r) }));
  assert.equal(out.stoppedBecause, 'fair', JSON.stringify(out.error));
  assert.equal(out.records.length, 2);
  const [r1, r2] = out.records;
  assert.equal(r1.parentHash, w.base.dataHash);
  assert.equal(r2.parentHash, r1.dataHash);
  assert.notEqual(r1.dataHash, r2.dataHash);
  assert.equal(out.headHash, r2.dataHash);
  for (const r of out.records) {
    assert.equal(r.gameId, 'hero_arena');
    assert.equal(r.origin, 'fake');
    assert.equal(r.approved, true);
    assert.equal(r.verdict.verdict, 'accepted');
    assert.equal(r.createdAt, '2026-11-14T00:00:00.000Z');
  }
  assert.deepEqual(r1.changes, [{ path: '/moves/1/power', label: 'B power', old: 92, new: 72 }]);
  assert.equal(r1.target.matchup, 'bari vs daewi');
  assert.equal(r1.target.before.rate, 0.8);
  assert.equal(r1.target.after.rate, 0.65);
  assert.equal(r1.target.after.games, 200);
  assert.equal(r2.target.after.rate, 0.5);
  assert.equal(out.finalCheck.rows.length, ROSTER.length); // all matchups, on the last accepted hash
  assert.equal(out.finalCheck.dataHash, r2.dataHash);
  assert.deepEqual(records, out.records);
  assert.equal(baseVersionRecord({ gameId: 'hero_arena', dataHash: w.base.dataHash, createdAt: 'x' }).origin, 'base');
});

test('rounds scan only what was flagged (all matchups first); holdout seeds are fresh', async () => {
  const w = world(cleanModel);
  await runAuto(w.input({ rounds: 3 }));
  const scans = w.calls.filter((c) => c.seeds[0] === 1);
  const holdouts = w.calls.filter((c) => c.seeds[0] > 1000000);
  assert.deepEqual(scans[0].matchups, ROSTER);
  assert.deepEqual(scans[1].matchups, ['bari vs daewi']);
  assert.deepEqual(holdouts.map((c) => c.matchups), [['bari vs daewi'], ['bari vs daewi']]);
  assert.notDeepEqual(holdouts[0].seeds, holdouts[1].seeds);
  assert.deepEqual(scans.at(-1).matchups, ROSTER); // the final check
});

test('requireApproval (the default) stops after the first record and skips the final check', async () => {
  const w = world(cleanModel);
  const { requireApproval, ...rest } = w.input();
  const out = await runAuto(rest);
  assert.equal(requireApproval, false);
  assert.equal(out.stoppedBecause, 'awaiting_approval');
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].approved, false);
  assert.equal(out.records[0].verdict.verdict, 'accepted');
  assert.equal(out.finalCheck, null);
  assert.equal(out.headHash, w.base.dataHash); // nothing was approved yet
});

test('a verdict that is not accepted stops the run; the record is kept and not approved', async () => {
  const w = world((dim, p) => (dim === 'bari vs daewi' ? 0.8 + (92 - p) * 0.005 : 0.5)); // lowering makes it worse
  const out = await runAuto(w.input());
  assert.equal(out.stoppedBecause, 'not_accepted');
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].verdict.verdict, 'rejected');
  assert.equal(out.records[0].approved, false);
  assert.equal(out.headHash, w.base.dataHash);
  assert.equal(out.finalCheck.dataHash, w.base.dataHash);
});

test('a patch that changes nothing is not accepted and makes no record', async () => {
  const w = world(cleanModel, { step: 0, floor: 92 });
  const out = await runAuto(w.input());
  assert.equal(out.stoppedBecause, 'not_accepted');
  assert.equal(out.records.length, 0);
  assert.equal(out.noChange, true);
});

test('regression: another matchup becomes extreme, so the last accepted version is marked rejected', async () => {
  const w = world((dim, p) => (dim === 'bari vs daewi' ? cleanModel(dim, p)
    : dim === 'daewi vs real_armor' ? 0.5 + ((92 - p) / 40) * 0.25 : 0.5));
  const seen = [];
  const out = await runAuto(w.input({ rounds: 2, onRecord: (r) => seen.push(r) }));
  assert.equal(out.stoppedBecause, 'regression', JSON.stringify(out.error));
  assert.equal(out.records.length, 2);
  const [r1, r2] = out.records;
  assert.equal(r1.verdict.verdict, 'accepted'); // holdouts only covered the flagged matchup
  assert.equal(r2.verdict.verdict, 'rejected');
  assert.equal(r2.approved, false);
  assert.match(r2.verdict.reasons.join(), /new extreme matchup: daewi vs real_armor/);
  assert.equal(out.headHash, r1.dataHash);
  assert.equal(seen.length, 3); // two records, plus the revised second record
  assert.equal(out.finalCheck.rows.length, ROSTER.length);
});

test('the round limit stops a run that is still improving', async () => {
  const w = world((dim, p) => (dim === 'bari vs daewi' ? 0.8 - (92 - p) * 0.0025 : 0.5)); // 80 -> 75 -> 70
  const out = await runAuto(w.input({ rounds: 2 }));
  assert.equal(out.stoppedBecause, 'rounds');
  assert.equal(out.records.length, 2);
  assert.ok(out.records.every((r) => r.verdict.verdict === 'accepted'));
  assert.ok(out.finalCheck);
});

test('branching: a run can start from a non-head version, and the parent is that version', async () => {
  const w = world(cleanModel);
  const side = w.keep({ ...structuredClone(w.base.data), moves: [{ id: 'a', power: 50 }, { id: 'b', power: 72 }] });
  const out = await runAuto(w.input({ fromHash: side.dataHash, data: side.data }));
  assert.equal(out.stoppedBecause, 'fair', JSON.stringify(out.error));
  assert.equal(out.records[0].parentHash, side.dataHash);
  assert.notEqual(out.records[0].parentHash, w.base.dataHash);
  assert.equal(out.records[0].target.before.rate, 0.65);
});

test('progress and records are reported', async () => {
  const w = world(cleanModel);
  const events = [];
  await runAuto(w.input({ rounds: 1, onProgress: (e) => events.push(e) }));
  const phases = events.map((e) => e.phase);
  assert.ok(['scan', 'holdout', 'final_check'].every((p) => phases.includes(p)), phases.join());
  const done = events.filter((e) => e.matchesDone > 0 && e.phase === 'scan')[0];
  assert.equal(done.matchesDone, done.totalMatches); // 4 matchups x 100 seeds x 2 seats
  assert.equal(done.totalMatches, 800);
});

test('bad input and failures are results with stoppedBecause "error", never throws', async () => {
  const w = world(cleanModel);
  const code = (o) => o.error?.code;
  assert.equal(code(await runAuto(w.input({ rounds: 6 }))), 'INVALID_INPUT');
  assert.equal(code(await runAuto(w.input({ rounds: 0 }))), 'INVALID_INPUT');
  assert.equal(code(await runAuto(w.input({ runBatch: undefined }))), 'INVALID_INPUT');
  assert.equal(code(await runAuto(w.input({ allMatchups: [] }))), 'INVALID_INPUT');
  assert.equal(code(await runAuto(w.input({ fromHash: 'f'.repeat(64) }))), 'DATA_HASH_MISMATCH');
  assert.equal((await runAuto()).stoppedBecause, 'error');
  const wrongHash = await runAuto(w.input({ runBatch: async (h, m, s) => (await w.runBatch(h, m, s))
    .map((r) => ({ ...r, config: { ...r.config, dataHash: 'e'.repeat(64) } })) }));
  assert.equal(code(wrongHash), 'DATA_HASH_MISMATCH');
  const failing = await runAuto(w.input({ rounds: 3, runBatch: async (h, m, s) => {
    if (s[0] > 1000000) throw new Error('worker crashed');
    return w.runBatch(h, m, s);
  } }));
  assert.equal(failing.stoppedBecause, 'error');
  assert.equal(code(failing), 'SIMULATION_FAILED');
  assert.equal(failing.finalCheck, null);
  const rejectedByEngine = await runAuto(w.input({ applyPatch: () => { throw new Error('PATCH_REJECTED'); } }));
  assert.equal(code(rejectedByEngine), 'INVALID_PATCH');
});
