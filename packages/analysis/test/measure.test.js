import test from 'node:test';
import assert from 'node:assert/strict';
import { measureFull } from '../pipeline/measure-full.js';
import { steppingAdapter } from '../pipeline/record-auto-history.js';
import { BOT_SEED_DERIVATIONS, createArenaSimulator, loadArenaSimulator } from '../pipeline/arena-simulator.js';
import { engineRoot, importEngine, recordedRosterResults } from './engine.js';

const arena = await importEngine('packages/games/action/index.js');
const bot = await importEngine('packages/games/action/bot.js');
const { hash, compareIds } = await importEngine('packages/contracts/index.js');

test('measureFull wiring on a tiny run (2 pairs, not a measurement): too few games, so it stops as fair', async () => {
  const out = await measureFull({ mode: 'nonroster', pairs: 2, engineRoot });
  assert.equal(out.ok, true, JSON.stringify(out));
  const v = out.value;
  assert.equal(v.baseline.games, 4);
  assert.equal(v.phases.baseline.matches, 4);
  assert.equal(v.fair, true); // no outlier under 30 games: no proposal, no holdout run
  assert.equal(v.proposal, null);
  assert.equal(v.holdout, null);
  assert.equal(v.phases.holdout, undefined);
  assert.equal(v.verdict.verdict, 'inconclusive');
  assert.equal(v.botPolicyVersion, bot.botPolicyVersion);
});

test('measureFull: a missing engine is a clear error result', async () => {
  const out = await measureFull({ pairs: 1, engineRoot: '/no/such/engine' });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'ENGINE_UNAVAILABLE');
});

test('the bot seed derivation is injectable, and the engine policy has an entry (plug-in point)', async () => {
  assert.ok(BOT_SEED_DERIVATIONS[bot.botPolicyVersion],
    `add ${bot.botPolicyVersion} to BOT_SEED_DERIVATIONS in pipeline/arena-simulator.js`);
  const loaded = await loadArenaSimulator(engineRoot);
  assert.equal(loaded.ok, true, loaded.error?.message);
  assert.equal(loaded.value.botPolicyVersion, bot.botPolicyVersion);
  const [recorded] = recordedRosterResults();
  const calls = [];
  const spy = (args) => { calls.push(args); return BOT_SEED_DERIVATIONS[bot.botPolicyVersion](args, bot); };
  const sim = createArenaSimulator({ arena, chooseActions: bot.chooseActions, hash, compareIds, botSeed: spy });
  const out = sim.simulate({ config: recorded.config, data: arena.data });
  assert.equal(out.finalStateHash, recorded.finalStateHash);
  assert.ok(calls.length > 0 && calls.every((c) => c.config === recorded.config));
  assert.throws(() => createArenaSimulator({ arena, chooseActions: bot.chooseActions, hash, compareIds,
    botSeed: 'x' }), /botSeed must be a function/);
});

// --- the offline stand-in adapter used by the recorded history ---
const standInData = () => ({
  characters: [{ id: 'bari', moveIds: ['melee_b', 'arrow', 'guard_b'] },
    { id: 'daewi', moveIds: ['smash', 'wave', 'guard_d'] }, { id: 'sepia', moveIds: ['lash', 'ink', 'guard_s'] }],
  moves: [{ id: 'melee_b', archetype: 'melee', power: 50 }, { id: 'arrow', archetype: 'projectile', power: 92 },
    { id: 'guard_b', archetype: 'guard', power: 0 }, { id: 'smash', archetype: 'melee', power: 100 },
    { id: 'wave', archetype: 'projectile', power: 60 }, { id: 'guard_d', archetype: 'guard', power: 0 },
    { id: 'lash', archetype: 'melee', power: 40 }, { id: 'ink', archetype: 'projectile', power: 80 },
    { id: 'guard_s', archetype: 'guard', power: 0 }],
});
const standInRow = (dimension, winRate) => ({ dimension, wins: winRate * 200, games: 200, winRate, ci95: [0, 1],
  uses: 0, opportunities: 0, outlier: true });
const propose = (rows, uses) => steppingAdapter(() => standInData(), (hero) => uses[hero] ?? {})
  .proposeWithOrigin({ dataHash: 'a'.repeat(64), rows });

test('stand-in: a winning focus hero gets its most-used attack lowered by 20%', async () => {
  const { origin, proposal } = await propose([standInRow('bari vs daewi', 0.9), standInRow('bari vs sepia', 0.8)],
    { bari: { melee: 10, projectile: 500, guard: 900 } });
  assert.equal(origin, 'fake');
  assert.deepEqual(proposal.replacements, [{ path: '/moves/1/power', value: 73 }]); // arrow 92 -> 73
  assert.match(proposal.rationale, /lower arrow of bari by 20% \(bari is winning; its most-used attack is projectile/);
});

test('stand-in: a losing focus hero gets its most-used attack raised by 20%', async () => {
  const { proposal } = await propose([standInRow('bari vs daewi', 0.99), standInRow('daewi vs sepia', 0.2)],
    { daewi: { melee: 700, projectile: 20 } });
  // daewi is in both rows (the focus), loses to bari (1%) and wins 80% of daewi vs sepia: weighted 40% = losing
  assert.deepEqual(proposal.replacements, [{ path: '/moves/3/power', value: 120 }]); // smash 100 -> 120
  assert.match(proposal.rationale, /raise smash of daewi by 20% \(daewi is losing/);
});

test('stand-in: guard and move are never the lever, and power stays inside 1..10000', async () => {
  const data = standInData();
  data.moves[1].power = 9500;
  const adapter = steppingAdapter(() => data, () => ({ guard: 99999, projectile: 5, melee: 1 }));
  const { proposal } = await adapter.proposeWithOrigin({ dataHash: 'a'.repeat(64),
    rows: [standInRow('bari vs sepia', 0.1)] }); // focus: bari (alphabetical tie), losing
  assert.equal(proposal.replacements[0].path, '/moves/1/power');
  assert.equal(proposal.replacements[0].value, 10000);
});

test('stand-in follows the first recommendation of the diagnosis: path, direction and size', async () => {
  const adapter = steppingAdapter(() => standInData());
  const rec = (extra) => ({ diagnosis: { recommendations: [{ hero: 'daewi', role: 'loser', path: '/moves/3/power',
    direction: 'up', sizePct: 25, why: 'daewi is too weak', expected: 'x', ...extra }] } });
  const row = [standInRow('bari vs daewi', 0.9)];
  const up = await adapter.proposeWithOrigin({ dataHash: 'a'.repeat(64), rows: row }, rec({}));
  assert.deepEqual(up.proposal.replacements, [{ path: '/moves/3/power', value: 125 }]); // smash 100 -> +25%
  assert.equal(up.origin, 'fake');
  assert.match(up.proposal.rationale, /first recommendation \(up 25%\): daewi is too weak/);
  const down = await adapter.proposeWithOrigin({ dataHash: 'a'.repeat(64), rows: row },
    rec({ role: 'winner', hero: 'bari', path: '/moves/1/power', direction: 'down', sizePct: 30 }));
  assert.deepEqual(down.proposal.replacements, [{ path: '/moves/1/power', value: 64 }]); // arrow 92 -> -30%
  const data = standInData();
  data.tuning = { damageScalePermille: 1000 };
  const global = await steppingAdapter(() => data).proposeWithOrigin({ dataHash: 'a'.repeat(64), rows: row },
    rec({ path: '/tuning/damageScalePermille', direction: 'down', sizePct: 30, scope: 'global' }));
  assert.deepEqual(global.proposal.replacements, [{ path: '/tuning/damageScalePermille', value: 700 }]);
  // a recommendation it cannot apply falls back to the plain stand-in rule
  const bad = await adapter.proposeWithOrigin({ dataHash: 'a'.repeat(64), rows: row },
    rec({ path: '/moves/99/power' }));
  assert.match(bad.proposal.rationale, /^Offline stand-in: (lower|raise) /);
});
