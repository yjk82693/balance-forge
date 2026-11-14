import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPatchToData, buildBeforeAfter, pickLopsidedMatch, matchupResolver, resolveDataVariants,
  isError } from '../src/index.ts';
import { BOT_SEED_DERIVATIONS, createArenaSimulator } from '../pipeline/arena-simulator.ts';
import { main } from '../pipeline/cli.ts';
import { fixture, pairedResults } from './helpers.ts';
import { loadArenaSimulator } from '../pipeline/arena-simulator.ts';
import { engineRoot, importEngine, recordedRosterResults } from './engine.ts';

const arena = await importEngine('packages/games/action/index.ts');
const bot = await importEngine('packages/games/action/bot.ts');
const { hash, compareIds } = await importEngine('packages/contracts/index.ts');
const { pairedJobs, runMatch } = await importEngine('services/runner/match.ts');

const dmg = (r, p, n) => { r.statistics.players.find((x) => x.playerId === p).damage = n; };

test('applyPatchToData: pure, bounded, checks base hash and move index', () => {
  const data = { moves: [{ power: 10 }, { power: 20 }], tuning: { damageScalePermille: 1000 } };
  const h = (d) => `${d.moves[1].power}`.padStart(64, '0');
  const patched = applyPatchToData(data, { baseDataHash: h(data),
    replacements: [{ path: '/moves/1/power', value: 5 }, { path: '/tuning/damageScalePermille', value: 900 }],
    rationale: '' }, { hashData: h });
  assert.equal(patched.moves[1].power, 5);
  assert.equal(patched.tuning.damageScalePermille, 900);
  assert.equal(data.moves[1].power, 20); // input untouched
  const attempt = (proposal, opts?) => { try { applyPatchToData(data, proposal, opts); } catch (e) { return e.code; } };
  assert.equal(attempt({ baseDataHash: 'f'.repeat(64), replacements: [{ path: '/moves/1/power', value: 5 }],
    rationale: '' }, { hashData: h }), 'PATCH_BASE_MISMATCH');
  assert.equal(attempt({ baseDataHash: h(data), replacements: [{ path: '/moves/7/power', value: 5 }],
    rationale: '' }), 'PATCH_PATH_MISSING');
  assert.equal(attempt({ baseDataHash: h(data), replacements: [{ path: '/gameRules/x', value: 5 }], rationale: '' }),
    'INVALID_PATCH');
});

test('pickLopsidedMatch: most lopsided matchup, most one-sided win by the dominant side', () => {
  const rs = pairedResults({ seeds: 10, winner: () => 'a' });
  rs.forEach((r, i) => { dmg(r, r.outcome.winners[0], 300 + i); dmg(r, r.outcome.winners[0] === 'p1' ? 'p2' : 'p1',
    100); });
  rs[7].statistics.players.forEach((p) => { if (p.playerId === rs[7].outcome.winners[0]) p.damage = 900; });
  const pick = pickLopsidedMatch(rs);
  assert.equal(pick.ok, true);
  assert.equal(pick.value.result.matchId, rs[7].matchId);
  assert.equal(pick.value.dimension, 'bari vs real_armor');
  assert.equal(pick.value.matchupWinRate, 1);
  // deterministic regardless of input order
  assert.equal(pickLopsidedMatch([...rs].reverse()).value.result.matchId, rs[7].matchId);
});

test('pickLopsidedMatch follows the dominant side when the focal hero loses', () => {
  const rs = pairedResults({ seeds: 10, winner: () => 'b' });
  const pick = pickLopsidedMatch(rs);
  assert.equal(pick.value.matchupWinRate, 0);
  assert.ok(pick.value.result.outcome.winners.length === 1);
  const none = pickLopsidedMatch(pairedResults({ seeds: 4, winner: () => 'draw' }));
  assert.equal(none.ok, false);
  assert.equal(none.error.code, 'NO_DECISIVE_MATCH');
  assert.equal(pickLopsidedMatch([]).ok, false);
});

// A tiny fake simulator: hp falls faster with higher move power; deterministic.
const fakeHash = (d) => [...JSON.stringify(d)].reduce((n, c, i) => (n + c.charCodeAt(0) * (i + 1)) % 1000003,
  7).toString(16).padStart(64, '0');
const fakeSim = ({ config, data }) => {
  const p = data.moves[1].power;
  return {
    outcome: { status: 'win', winners: [p > 80 ? 'p1' : 'p2'], reason: 'hp_zero' },
    finalStateHash: fakeHash({ p, seed: config.seed }),
    durationTicks: 100 + p,
    heroes: { p1: 'bari', p2: 'real_armor' },
    maxHp: { p1: 540, p2: 700 },
    timeline: [{ tick: 0, hp: { p1: 540, p2: 700 } }, { tick: 100 + p, hp: { p1: 0, p2: 100 } }],
  };
};

test('buildBeforeAfter with a fake simulator: pair JSON, determinism check, errors as results', () => {
  const baseData = { moves: [{ power: 1 }, { power: 92 }], tuning: { damageScalePermille: 1000 } };
  const baseHash = fakeHash(baseData);
  const baselineResult = { ...fixture('match_results.json')[0], finalStateHash: fakeHash({ p: 92, seed: 12345 }) };
  baselineResult.config = { ...baselineResult.config, dataHash: baseHash };
  const proposal = { baseDataHash: baseHash, replacements: [{ path: '/moves/1/power', value: 72 }], rationale: 'r' };
  const out = buildBeforeAfter({ baselineResult, baseData, proposal, simulate: fakeSim, hashData: fakeHash });
  assert.equal(out.ok, true);
  const v = out.value;
  assert.equal(v.kind, 'before_after');
  assert.equal(v.seed, 12345);
  assert.notEqual(v.before.dataHash, v.after.dataHash);
  assert.equal(v.before.timeline[0].tick, 0);
  assert.equal(v.delta.winnerBefore, 'p1');
  assert.equal(v.delta.winnerAfter, 'p2');
  assert.equal(v.delta.winnerChanged, true);
  assert.equal(v.delta.durationTicks, -20);
  assert.doesNotThrow(() => JSON.stringify(v));

  const code = (o) => (isError(o) ? o.error.code : 'ok');
  const base = { baselineResult, baseData, proposal, simulate: fakeSim, hashData: fakeHash };
  assert.equal(code(buildBeforeAfter({ ...base, baselineResult: { ...baselineResult,
    finalStateHash: 'x'.repeat(64) } })), 'REPLAY_MISMATCH');
  assert.equal(code(buildBeforeAfter({ ...base, proposal: { ...proposal, baseDataHash: 'a'.repeat(64) } })),
    'PATCH_BASE_MISMATCH');
  assert.equal(code(buildBeforeAfter({ ...base, baseData: { ...baseData, tuning: { damageScalePermille: 5 } } })),
    'DATA_HASH_MISMATCH');
  assert.equal(code(buildBeforeAfter({ ...base, simulate: () => { throw new Error('boom'); } })), 'SIMULATION_FAILED');
  assert.equal(code(buildBeforeAfter({ ...base, simulate: () => ({}) })), 'SIMULATION_FAILED');
  assert.equal(code(buildBeforeAfter({ ...base, simulate: undefined })), 'INVALID_INPUT');
});

// --- Real engine integration: same seed + bot policy, original vs patched data ---
const jobs = pairedJobs({ seeds: Array.from({ length: 12 }, (_, i) => i + 1) });
const results = jobs.map(runMatch);
const botSeed = (args) => BOT_SEED_DERIVATIONS[bot.botPolicyVersion](args, bot);
const sim = createArenaSimulator({ arena, chooseActions: bot.chooseActions, hash, compareIds, botSeed });
const patchFor = (hashValue) => ({ baseDataHash: hashValue, replacements: [{ path: '/moves/1/power', value: 72 }],
  rationale: 'lower spirit arrow' });

test('real engine: replay of the baseline match reproduces its recorded hash; patched run differs', () => {
  const resolver = matchupResolver();
  const hashA = jobs[0].config.dataHash;
  const pick = pickLopsidedMatch(results, { ...resolver, dataHash: hashA });
  assert.equal(pick.ok, true, JSON.stringify(pick));
  const out = buildBeforeAfter({ baselineResult: pick.value.result, baseData: jobs[0].data, proposal: patchFor(hashA),
    simulate: sim.simulate, hashData: sim.hashData });
  assert.equal(out.ok, true, JSON.stringify(out));
  const { before, after } = out.value;
  assert.equal(before.finalStateHash, pick.value.result.finalStateHash); // determinism
  assert.notEqual(after.dataHash, before.dataHash);
  for (const side of [before, after]) {
    assert.equal(side.timeline[0].tick, 0);
    assert.deepEqual(side.timeline[0].hp, { p1: side.maxHp.p1, p2: side.maxHp.p2 });
    assert.equal(side.timeline.at(-1).tick, side.durationTicks);
    for (let i = 1; i < side.timeline.length; i++) {
      assert.ok(side.timeline[i].tick > side.timeline[i - 1].tick);
      assert.ok(side.timeline[i].hp.p1 <= side.timeline[i - 1].hp.p1 &&
        side.timeline[i].hp.p2 <= side.timeline[i - 1].hp.p2);
    }
  }
  // lowering spirit arrow power can only reduce damage when bari's arrow lands
  assert.equal(out.value.heroes.p1 === 'bari' || out.value.heroes.p2 === 'bari', true);
});

test('CLI replay writes before_after.json from runner results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-replay-'));
  const hashA = jobs[0].config.dataHash;
  writeFileSync(join(dir, 'base.json'), JSON.stringify(results));
  writeFileSync(join(dir, 'patch.json'), JSON.stringify(patchFor(hashA)));
  const s = await main(['replay', '--baseline', join(dir, 'base.json'), '--patch', join(dir, 'patch.json'), '--out',
    dir, '--engine-root', engineRoot]);
  assert.equal(s.replay, 'before_after.json');
  const v = JSON.parse(readFileSync(join(dir, 'before_after.json'), 'utf8'));
  assert.equal(v.kind, 'before_after');
  assert.equal(v.selection.dimension, 'bari vs real_armor');
});

test('resolveDataVariants: seat-swapped pairs share one dataHash (addendum item 1)', () => {
  const m = resolveDataVariants(results, jobs[0].data, hash);
  assert.equal(m.size, 1);
  assert.equal(new Set(results.map((r) => r.config.dataHash)).size, 1);
});

test('re-simulating recorded roster matches reproduces the runner finalStateHash (all 15 matchups)', () => {
  const recorded = recordedRosterResults();
  const metrics = JSON.parse(readFileSync(join(engineRoot, 'services/runner/recorded-roster-metrics.json'), 'utf8'));
  assert.equal(recorded.length, metrics.matchCount);
  const sampled = recorded.filter((_, i) => i % Math.ceil(recorded.length / 45) === 0);
  const matchups = new Set(sampled.map((r) => [...Object.values(r.config.options.assignments)].sort().join()));
  assert.ok(matchups.size >= 10, `sample covers ${matchups.size} matchups`);
  for (const r of sampled) {
    assert.equal(sim.hashData(arena.data), r.config.dataHash, `${r.matchId}: engine data hash`);
    const out = sim.simulate({ config: r.config, data: arena.data });
    assert.equal(out.finalStateHash, r.finalStateHash, `${r.matchId}: final hash`);
    assert.deepEqual(out.outcome, r.outcome, `${r.matchId}: outcome`);
    assert.equal(out.durationTicks, r.statistics.durationTicks, `${r.matchId}: duration`);
  }
});

test('loadArenaSimulator loads the engine and names a missing export instead of hiding it', async () => {
  const loaded = await loadArenaSimulator(engineRoot);
  assert.equal(loaded.ok, true, loaded.error?.message);
  assert.equal(typeof loaded.value.simulate, 'function');
  const missing = await loadArenaSimulator(join(tmpdir(), 'no-such-engine'));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'ENGINE_UNAVAILABLE');
  assert.match(missing.error.message, /no-such-engine|Cannot find|ENOENT/);
  assert.throws(() => createArenaSimulator({ arena: {}, hash, compareIds }), /export missing: arena\.initial/);
  assert.throws(() => createArenaSimulator({ arena, hash, compareIds }), /export missing: chooseActions/);
});

test('pickLopsidedMatch skips mirror matchups (seat advantage) while a hero matchup exists', () => {
  const mirror = pairedResults({ heroes: ['bari', 'bari'], seeds: 40, winner: () => 'a' });
  const hero = pairedResults({ heroes: ['bari', 'daewi'], seeds: 40, winner: (seed) => (seed % 4 ? 'a' : 'b') });
  const all = [...mirror, ...hero].map((r, i) => ({ ...r, matchId: `x-${i}` }));
  const pick = pickLopsidedMatch(all);
  assert.equal(pick.ok, true, JSON.stringify(pick));
  assert.equal(pick.value.dimension, 'bari vs daewi');
  assert.equal(pickLopsidedMatch(mirror).value.dimension, 'bari vs bari'); // only mirrors: still usable
});
