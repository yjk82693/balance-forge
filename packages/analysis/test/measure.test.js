import test from 'node:test';
import assert from 'node:assert/strict';
import { measureFull } from '../pipeline/measure-full.js';
import { BOT_SEED_DERIVATIONS, createArenaSimulator, loadArenaSimulator } from '../pipeline/arena-simulator.js';
import { engineRoot, importEngine, recordedRosterResults } from './engine.js';

const arena = await importEngine('packages/games/action/index.js');
const bot = await importEngine('packages/games/action/bot.js');
const { hash, compareIds } = await importEngine('packages/contracts/index.js');

test('measureFull wiring on a tiny run (2 pairs, not a measurement)', async () => {
  const out = await measureFull({ mode: 'nonroster', pairs: 2, engineRoot });
  assert.equal(out.ok, true, JSON.stringify(out));
  const v = out.value;
  assert.equal(v.baseline.games, 4);
  assert.equal(v.holdout.games, 4);
  assert.equal(v.phases.baseline.matches, 4);
  assert.equal(v.proposal.origin, 'fake');
  assert.equal(v.validation.ok, true);
  assert.ok(['accepted', 'rejected', 'inconclusive'].includes(v.verdict.verdict));
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
