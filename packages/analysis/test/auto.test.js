import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { baseVersionRecord, candidateDiagnoses, focusTargets, improvement, runAuto } from '../pipeline/auto.js';
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
      const rate = model(dim, power(data), data);
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
    for (const { path, value } of proposal.replacements) {
      const [, kind, index, field] = path.split('/');
      if (kind === 'characters') next.characters[Number(index)][field] = value;
      else next.moves[Number(index)].power = value;
    }
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

test('a verdict that is not accepted does not stop the run: the hero goes to needs_designer', async () => {
  const w = world((dim, p) => (dim === 'bari vs daewi' ? 0.8 + (92 - p) * 0.005 : 0.5)); // lowering makes it worse
  const out = await runAuto(w.input());
  // Both heroes of the flagged matchup were tried (bari, then daewi); the same patch is not tried twice.
  assert.equal(out.stoppedBecause, 'needs_designer');
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].verdict.verdict, 'rejected');
  assert.equal(out.records[0].approved, false);
  assert.equal(out.headHash, w.base.dataHash);
  assert.equal(out.finalCheck.dataHash, w.base.dataHash);
  assert.deepEqual(out.needs_designer.map((n) => n.hero), ['bari', 'daewi']);
  const [bari, daewi] = out.needs_designer;
  assert.deepEqual(bari.tried.map((t) => [t.path, t.old, t.new, t.outcome]), [['/moves/1/power', 92, 72, 'rejected']]);
  assert.equal(bari.tried[0].label, 'B power');
  assert.deepEqual(daewi.tried.map((t) => [t.outcome, t.reason]), [['skipped', 'this version was already tried']]);
  assert.equal(typeof bari.evidence, 'string');
  assert.match(bari.evidence, /bari is flagged\. 1 lever\(s\) tried \(B power rejected\)/);
  assert.match(bari.evidence, /bari vs daewi at 80\.0% \(200 games\)/);
});

test('a patch that changes nothing makes no record; the hero is handed to a designer', async () => {
  const w = world(cleanModel, { step: 0, floor: 92 });
  const out = await runAuto(w.input());
  assert.equal(out.stoppedBecause, 'needs_designer');
  assert.equal(out.records.length, 0);
  assert.deepEqual(out.needs_designer.map((n) => [n.hero, n.tried[0].outcome, n.tried[0].reason]),
    [['bari', 'skipped', 'the patch changes nothing'], ['daewi', 'skipped', 'the patch changes nothing']]);
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
  // The room service rejects rounds outside 1..rounds+1, so the final check is reported as round rounds + 1.
  assert.ok(events.every((e) => Number.isInteger(e.round) && e.round >= 1 && e.round <= 2), JSON.stringify(events));
  assert.equal(events.find((e) => e.phase === 'final_check').round, 2);
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

test('focusTargets: the hero in the most flagged matchups, ties alphabetical, mirrors never', () => {
  assert.deepEqual(focusTargets([]), []);
  assert.deepEqual(focusTargets(['bari vs daewi']), ['bari vs daewi']);
  assert.deepEqual(focusTargets(['bari vs daewi', 'daewi vs real_armor', 'daewi vs sepia']),
    ['bari vs daewi', 'daewi vs real_armor', 'daewi vs sepia']);
  assert.deepEqual(focusTargets(['bari vs real_armor', 'daewi vs sepia']), ['bari vs real_armor']);
});

test('a round targets one hero; the other flagged matchups are scanned again in later rounds', async () => {
  // Bari's two matchups fall with move b; the third flagged matchup (daewi vs real_armor) does not depend on it.
  const w = world((dim, p) => (dim === 'daewi vs real_armor' ? 0.8 : dim.startsWith('bari vs')
    ? 0.5 + ((p - 52) / 40) * 0.3 : 0.5));
  const roster = ['bari vs bari', 'bari vs daewi', 'bari vs real_armor', 'daewi vs real_armor'];
  const out = await runAuto(w.input({ allMatchups: roster, rounds: 3 }));
  const holdouts = w.calls.filter((c) => c.seeds[0] > 1000000);
  assert.deepEqual(holdouts[0].matchups, ['bari vs daewi', 'bari vs real_armor']); // not daewi vs real_armor
  assert.equal(out.records[0].verdict.verdict, 'accepted', JSON.stringify(out.records[0].verdict));
  const scans = w.calls.filter((c) => c.seeds[0] === 1);
  assert.deepEqual(scans[1].matchups, ['bari vs daewi', 'bari vs real_armor', 'daewi vs real_armor']);
  // It does not claim "fair" while a matchup is still flagged. Round 3 targets the one left, and this stub adapter has
  // nothing left to lower (move b is at its floor), so the patch changes nothing: no third record, and the hero is
  // handed to a designer. The rounds are used up.
  assert.equal(out.stoppedBecause, 'rounds');
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.needs_designer.map((n) => [n.hero, n.tried[0].reason]),
    [['daewi', 'the patch changes nothing']]);
  assert.deepEqual(scans[2].matchups, ['bari vs daewi', 'bari vs real_armor', 'daewi vs real_armor']);
});

// --- the diagnosis chooses the hero of a round ---
const heroData = (base) => ({ ...base,
  characters: ['bari', 'daewi', 'sepia'].map((id) => ({ id, moveIds: ['a', 'b'] })),
  moves: [{ id: 'a', archetype: 'melee', power: 50 }, { id: 'b', archetype: 'projectile', power: 92 }] });

test('Bari beats Daewi, but Daewi loses to everyone: the round targets Daewi (a buff), not Bari', async () => {
  const w = world((dim) => ({ 'bari vs daewi': 0.9, 'daewi vs sepia': 0.1, 'bari vs sepia': 0.5 })[dim] ?? 0.5);
  const data = heroData(w.base.data);
  const store = w.keep(data);
  const roster = ['bari vs bari', 'bari vs daewi', 'bari vs sepia', 'daewi vs daewi', 'daewi vs sepia',
    'sepia vs sepia'];
  let context;
  const adapter = { async proposeWithOrigin(report, ctx) {
    context ??= ctx; // the first candidate's context
    return w.input().adapter.proposeWithOrigin(report);
  } };
  const out = await runAuto(w.input({ fromHash: store.dataHash, data, allMatchups: roster, rounds: 1, adapter }));
  assert.ok(out.records.length > 0, JSON.stringify([out.stoppedBecause, out.error]));
  const holdouts = w.calls.filter((c) => c.seeds[0] > 1000000);
  assert.deepEqual(holdouts[0].matchups, ['bari vs daewi', 'daewi vs sepia']); // Daewi's matchups, not Bari's
  assert.equal(out.diagnoses.length, 1);
  assert.equal(out.diagnoses[0].round, 1);
  assert.equal(out.diagnoses[0].diagnosis.classification, 'overall_weak');
  assert.equal(out.diagnoses[0].diagnosis.focusHero, 'daewi');
  // the adapter got the diagnosis as context, with the candidate's recommendation first
  assert.equal(context.diagnosis.classification, out.diagnoses[0].diagnosis.classification);
  assert.deepEqual(context.diagnosis.recommendations[0], out.diagnoses[0].diagnosis.recommendations[0]);
});

test('later rounds run only the matchups the diagnosis still needs, on the scan seeds, as phase diagnose', async () => {
  // Round 1 scans everything. After an accepted round, round 2 scans only the flagged matchup, so the diagnosis has to
  // run the focus heroes' other matchups itself.
  const w = world((dim, p) => (dim === 'bari vs daewi' ? 0.5 + ((p - 52) / 40) * 0.3 : 0.5));
  const data = heroData(w.base.data);
  const store = w.keep(data);
  const roster = ['bari vs bari', 'bari vs daewi', 'bari vs sepia', 'daewi vs daewi', 'daewi vs sepia',
    'sepia vs sepia'];
  const events = [];
  const out = await runAuto(w.input({ fromHash: store.dataHash, data, allMatchups: roster, rounds: 2,
    onProgress: (e) => events.push(e) }));
  assert.equal(out.records.length >= 1, true, JSON.stringify(out.error));
  const round2 = w.calls.filter((c) => c.seeds[0] === 1 && c.matchups.length < roster.length);
  assert.deepEqual(round2[0].matchups, ['bari vs daewi']); // the narrowed scan
  const diagnose = w.calls.find((c) => c.matchups.includes('bari vs sepia') && c.matchups.length === 2);
  assert.deepEqual(diagnose.matchups, ['bari vs sepia', 'daewi vs sepia']);
  assert.deepEqual(diagnose.seeds, round2[0].seeds);
  assert.ok(events.some((e) => e.phase === 'diagnose' && e.round === 2));
  assert.equal(out.diagnoses.length, 2);
});

// --- two candidates per round: the first two recommendations, siblings of one parent ---
const statData = (base) => ({ ...heroData(base), characters: ['bari', 'daewi', 'sepia'].map((id, i) => ({ id,
  moveIds: ['a', 'b'], health: 500 + 50 * i, speed: 100 - 15 * i })) });
const ROSTER3 = ['bari vs bari', 'bari vs daewi', 'bari vs sepia', 'daewi vs daewi', 'daewi vs sepia',
  'sepia vs sepia'];
const daewi = (data) => data.characters.find((c) => c.id === 'daewi');
/** Asks for exactly what the candidate's first recommendation says (a stat or a power, by sizePct). */
const followFirst = (store) => ({ async proposeWithOrigin(report, context) {
  const rec = context.diagnosis.recommendations[0];
  const data = store.get(report.dataHash);
  const [, kind, index, field] = rec.path.split('/');
  const current = kind === 'characters' ? data.characters[Number(index)][field] : data.moves[Number(index)].power;
  const value = Math.round(current * (100 + (rec.direction === 'up' ? rec.sizePct : -rec.sizePct)) / 100);
  return { origin: 'fake', proposal: { baseDataHash: report.dataHash, rationale: rec.why,
    replacements: [{ path: rec.path, value }] } };
} });
// daewi is weak: bari vs daewi 90% and daewi vs sepia 10% at speed 85; speed helps by `speedGain` per +10, health by
// `healthGain` per +50 (from the original 550).
const weakDaewi = (speedGain, healthGain) => (dim, p, data) => {
  const d = daewi(data);
  const help = ((d.speed - 85) / 10) * speedGain + ((d.health - 550) / 50) * healthGain;
  return { 'bari vs daewi': 0.9 - help, 'daewi vs sepia': 0.1 + help }[dim] ?? 0.5;
};
const setup = (model, extra = {}) => {
  const w = world(model);
  const data = statData(w.base.data);
  const store = w.keep(data);
  return { w, data, store, run: (more) => runAuto(w.input({ fromHash: store.dataHash, data, allMatchups: ROSTER3,
    adapter: followFirst(w.store), ...extra, ...more })) };
};

test('three candidates per round: all recorded as siblings of one parent, the accepted one continues', async () => {
  // Speed (the weak hero's first stat) helps a lot; health, the second candidate, changes nothing.
  const { w, store, run } = setup(weakDaewi(0.1, 0));
  const out = await run({ rounds: 1 });
  assert.equal(out.records.length, 3, JSON.stringify(out.error));
  const [speed, health, shared] = out.records;
  assert.equal(speed.parentHash, store.dataHash);
  assert.equal(shared.parentHash, store.dataHash);
  assert.match(shared.changes[0].path, /^\/moves\/\d+\/power$/); // the third lever: a shared attack, ranked last
  assert.equal(shared.verdict.verdict, 'rejected');
  assert.equal(health.parentHash, store.dataHash); // siblings: the same parent
  assert.notEqual(speed.dataHash, health.dataHash);
  assert.match(speed.changes[0].path, /^\/characters\/1\/speed$/);
  assert.match(health.changes[0].path, /^\/characters\/1\/health$/);
  assert.equal(speed.verdict.verdict, 'accepted');
  assert.equal(health.verdict.verdict, 'rejected');
  assert.deepEqual([speed.approved, health.approved], [true, false]);
  assert.match(speed.note, /candidate 1 of 3; auto-approved/);
  assert.match(health.note, /candidate 2 of 3/);
  assert.equal(out.headHash, speed.dataHash);
  const holdouts = w.calls.filter((c) => c.seeds[0] > 1000000);
  assert.equal(holdouts.length, 3); // each candidate was holdout-tested
  assert.deepEqual(holdouts[0].seeds, holdouts[1].seeds); // on the round's fresh seeds, matched between candidates
  assert.deepEqual(holdouts[0].seeds, holdouts[2].seeds);
});

test('when both are accepted the one with the larger summed improvement continues', async () => {
  const { run } = setup(weakDaewi(0.05, 0.12)); // health helps more than speed here
  const out = await run({ rounds: 1 });
  const [speed, health] = out.records;
  assert.equal(speed.verdict.verdict, 'accepted');
  assert.equal(health.verdict.verdict, 'accepted');
  assert.ok(improvement(health.verdict.targets) > improvement(speed.verdict.targets));
  assert.deepEqual([speed.approved, health.approved], [false, true]);
  assert.match(speed.note, /accepted, not chosen: the other candidate improved more/);
  assert.equal(out.headHash, health.dataHash); // not the first one: the better one
  assert.equal(speed.parentHash, health.parentHash);
});

test('the next round continues from the chosen candidate, with that record as the parent', async () => {
  const { run } = setup(weakDaewi(0.03, 0.07)); // still flagged after round 1, so there is a round 2
  const out = await run({ rounds: 2 });
  const chosen = out.records.find((r) => r.approved);
  const next = out.records.find((r) => r.parentHash === chosen.dataHash);
  assert.ok(next, JSON.stringify(out.stoppedBecause));
  assert.equal(next.parentHash, chosen.dataHash);
});

test('no candidate accepted: records kept, hero to needs_designer, the run ends when no hero is left', async () => {
  const { store, run } = setup(weakDaewi(0, 0));
  const out = await run({ rounds: 3 });
  assert.equal(out.stoppedBecause, 'needs_designer');
  assert.equal(out.records.length, 3); // speed, health and a shared attack, all siblings of the head
  assert.ok(out.records.every((r) => r.parentHash === store.dataHash && r.approved === false));
  assert.ok(out.records.every((r) => r.verdict.verdict !== 'accepted'));
  assert.equal(out.headHash, store.dataHash);
  assert.equal(out.needs_designer.length, 1); // daewi is the only hero the diagnosis recommended
  const [daewi] = out.needs_designer;
  assert.equal(daewi.hero, 'daewi');
  assert.deepEqual(daewi.tried.map((t) => t.path), out.records.map((r) => r.changes[0].path));
  assert.deepEqual(daewi.tried.map((t) => t.outcome), ['rejected', 'rejected', 'rejected']);
  assert.deepEqual(Object.keys(daewi.tried[0]).sort(), ['label', 'new', 'old', 'origin', 'outcome', 'path']);
  assert.equal(daewi.tried[0].label, 'Daewi · Speed');
  assert.equal(daewi.tried[0].old, 85);
  assert.match(daewi.evidence,
    /daewi wins [0-9.]+% overall \(.* games, -[0-9.]+ points from 50%\)\. 3 lever\(s\) tried/);
});

test('after a hero is handed to a designer the next hero is worked on in the next round', async () => {
  // Nothing the adapter tries helps Daewi (the weakest: loses to Bari and to Sepia). Bari beats Sepia 85%, and
  // lowering Bari's health helps that matchup: the diagnosis of 'bari vs sepia' recommends Bari.
  const bari = (data) => data.characters.find((c) => c.id === 'bari');
  const { run } = setup((dim, p, data) => ({ 'bari vs daewi': 0.9, 'daewi vs sepia': 0.1,
    'bari vs sepia': 0.85 - ((500 - bari(data).health) / 50) * 0.04 }[dim] ?? 0.5));
  const out = await run({ rounds: 2 });
  assert.notEqual(out.stoppedBecause, 'error', JSON.stringify(out.error));
  assert.deepEqual(out.needs_designer.map((n) => n.hero), ['daewi']);
  const paths = out.records.map((r) => r.changes[0].path);
  assert.deepEqual(paths.slice(0, 3), ['/characters/1/speed', '/characters/1/health', paths[2]]); // round 1: daewi
  const fixed = out.records.find((r) => r.verdict.verdict === 'accepted');
  assert.equal(fixed.changes[0].path, '/characters/0/health'); // a later round: bari, lowered
  assert.ok(fixed.changes[0].new < fixed.changes[0].old);
  assert.equal(out.records.indexOf(fixed) >= 3, true);
});

test('with approval required both candidates are recorded unapproved and the run waits', async () => {
  const { run } = setup(weakDaewi(0.1, 0.1));
  const out = await run({ rounds: 2, requireApproval: true });
  assert.equal(out.stoppedBecause, 'awaiting_approval');
  assert.equal(out.records.length, 3);
  assert.ok(out.records.every((r) => r.approved === false));
  assert.equal(out.records.filter((r) => r.verdict.verdict === 'accepted').length, 2); // speed and health
  assert.equal(out.finalCheck, null);
});

test('a candidate that repeats a version, or fails validation, is skipped and the other one is used', async () => {
  const same = setup(weakDaewi(0.1, 0));
  const fixedPatch = { async proposeWithOrigin(report) { // an adapter that ignores the candidate order
    const speed = same.w.store.get(report.dataHash).characters[1].speed;
    return { origin: 'fake', proposal: { baseDataHash: report.dataHash, rationale: 'same twice',
      replacements: [{ path: '/characters/1/speed', value: Math.round(speed * 1.3) }] } };
  } };
  const first = await same.run({ rounds: 1, adapter: fixedPatch });
  assert.equal(first.records.length, 1); // the second candidate was the same version
  const flaky = setup(weakDaewi(0.1, 0));
  let calls = 0;
  const out = await flaky.run({ rounds: 1, adapter: { async proposeWithOrigin(report, ctx) {
    calls += 1;
    if (calls === 2) return { origin: 'fake', proposal: { baseDataHash: report.dataHash, rationale: 'bad',
      replacements: [{ path: '/characters/1/health', value: 99999 }] } };
    return followFirst(flaky.w.store).proposeWithOrigin(report, ctx);
  } } });
  // call 2 was invalid and was skipped; calls 1 and 3 became records (speed accepted, the shared attack rejected)
  assert.equal(out.records.length, 2);
  assert.equal(out.records[0].verdict.verdict, 'accepted');
  assert.ok(out.records.every((r) => r.changes[0].new !== 99999));
  assert.deepEqual(out.needs_designer, []);
  assert.equal(out.stoppedBecause !== 'error', true, JSON.stringify(out.error));
});

test('candidateDiagnoses: the focus hero recommendations, at most three, distinct paths, each first in turn', () => {
  const rec = (hero, path) => ({ hero, path, direction: 'up', sizePct: 10, why: '', expected: '', alsoAffects: [] });
  const diagnosis = { classification: 'overall_weak', focusHero: 'daewi', recommendations: [rec('daewi', '/p/1'),
    rec('daewi', '/p/1'), rec('daewi', '/p/2'), rec('daewi', '/p/3'), rec('bari', '/p/9')] };
  const variants = candidateDiagnoses(diagnosis, 'daewi');
  assert.equal(variants.length, 3);
  assert.deepEqual(variants.map((v) => v.recommendations[0].path), ['/p/1', '/p/2', '/p/3']);
  assert.equal(variants[1].recommendations.length, 5); // the full list is still there, only reordered
  assert.deepEqual(candidateDiagnoses(null, null), [null]); // no diagnosis: one plain candidate
  assert.equal(improvement([{ before: { rate: 0.9 }, after: { rate: 0.7 } }, { before: { rate: 0.2 },
    after: { rate: 0.3 } }]).toFixed(2), '0.30');
});

test('explain: the replay findings are added to the evidence of a hero handed to a designer', async () => {
  const calls = [];
  const { run } = setup(weakDaewi(0, 0));
  const out = await run({ rounds: 1, explain: async (args) => {
    calls.push(args);
    return 'Replays of daewi vs sepia: In range, daewi landed 6%.';
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hero, 'daewi');
  assert.equal(calls[0].matchup, 'bari vs daewi'); // the flagged matchup furthest from 50% (ties: alphabetical)
  const [note] = out.needs_designer;
  assert.match(note.evidence, /^daewi wins .* none moved a flagged matchup beyond noise\./);
  assert.match(note.evidence, /Replays of daewi vs sepia: In range, daewi landed 6%\.$/);
});

test('explain that fails or returns nothing never stops the run or breaks the evidence', async () => {
  for (const explain of [async () => { throw new Error('engine down'); }, async () => null, async () => 42, () => '']) {
    const { run } = setup(weakDaewi(0, 0));
    const out = await run({ rounds: 1, explain });
    assert.equal(out.needs_designer.length, 1);
    assert.doesNotMatch(out.needs_designer[0].evidence, /Replays of/);
    assert.match(out.needs_designer[0].evidence, /3 lever\(s\) tried/);
  }
});

test('runAuto reports where every candidate came from, including why a model answer was not used', async () => {
  const { w, run } = setup(weakDaewi(0.1, 0));
  const failing = { async proposeWithOrigin(report, context) {
    const got = await followFirst(w.store).proposeWithOrigin(report, context);
    return { ...got, origin: 'fallback', fallbackReason: 'HTTP 404' };
  } };
  const out = await run({ rounds: 1, adapter: failing });
  assert.equal(out.candidates.length, 3);
  assert.ok(out.candidates.every((c) => c.origin === 'fallback' && c.fallbackReason === 'HTTP 404'));
  assert.deepEqual(out.candidates.map((c) => c.candidate), [1, 2, 3]);
  assert.ok(out.candidates.every((c) => c.round === 1 && typeof c.dataHash === 'string'));
  assert.deepEqual(out.candidates.map((c) => c.outcome), ['accepted', 'rejected', 'rejected']);
  const hidden = setup(weakDaewi(0, 0)); // nothing helps: the hero is escalated and the tried levers carry the reason
  const bad = { async proposeWithOrigin(report, context) {
    const got = await followFirst(hidden.w.store).proposeWithOrigin(report, context);
    return { ...got, origin: 'fallback', fallbackReason: 'timeout' };
  } };
  const escalated = await hidden.run({ rounds: 1, adapter: bad });
  assert.ok(escalated.needs_designer[0].tried.every((t) => t.origin === 'fallback' && t.fallbackReason === 'timeout'));
  const plain = await setup(weakDaewi(0.1, 0)).run({ rounds: 1 });
  assert.ok(plain.candidates.every((c) => c.origin === 'fake' && !('fallbackReason' in c)));
});
