import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as bot from './bot.ts';
import { data, initial, makeConfig, observe, step } from './index.ts';
import { compareIds } from '../../contracts/index.ts';

// Plays one short match with a chooser per seat; returns the inputs of each seat.
function play(seed, choosers, maxTicks = 240) {
  const config = { ...makeConfig(data, seed), maxTicks, options: { assignments: { p1: 'bari', p2: 'real_armor' } } };
  let state = initial(config, data);
  const inputs = { p1: [], p2: [] };
  while (state.payload.outcome.status === 'running') {
    const actions = config.players.flatMap((id, i) => {
      const chosen = choosers[i](observe(state, id), state.tick * 2, bot.deriveBotSeed(seed, i));
      inputs[id].push(...chosen);
      return chosen;
    }).sort((a, b) => compareIds(a.playerId, b.playerId));
    state = step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
  }
  return { state, inputs };
}
const attacks = list => list.filter(a => a.actionId === 'melee' || a.actionId === 'projectile').length;

test('the gentle policy has its own version and is used only for the room bot seat', () => {
  assert.equal(bot.gentleBotPolicyVersion, 'scripted-0.2.1-gentle');
  assert.equal(bot.botPolicyVersion, 'scripted-0.2.1');
  const room = readFileSync(new URL('../../../services/room/server.ts', import.meta.url), 'utf8');
  assert.match(room, /chooseActionsGentle/);
  for (const file of ['services/runner/match.ts', 'services/runner/learn/evaluate.ts', 'services/room/auto.ts']) {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Gentle/, file);
  }
});

test('the gentle bot is deterministic and only plays legal inputs', () => {
  for (const seed of [3, 4, 5]) {
    const a = play(seed, [bot.chooseActionsGentle, bot.chooseActions]);
    const b = play(seed, [bot.chooseActionsGentle, bot.chooseActions]);
    assert.deepEqual(a.inputs, b.inputs);
    assert.equal(a.state.payload.outcome.status !== 'running', true);
  }
});

test('scripted-0.2.1 still plays and is deterministic (checked once against the pre-gentle code: 14,278 equal)', () => {
  const sample = play(7, [bot.chooseActions, bot.chooseActions]);
  assert.ok(attacks(sample.inputs.p1) > 0 && attacks(sample.inputs.p2) > 0);
  assert.deepEqual(sample.inputs, play(7, [bot.chooseActions, bot.chooseActions]).inputs);
});

test('the gentle bot attacks less often than the scripted one, with a hold after each attack', () => {
  let gentle = 0, scripted = 0;
  const gaps = [];
  for (let seed = 1; seed <= 12; seed++) {
    const g = play(seed, [bot.chooseActionsGentle, bot.chooseActions]).inputs.p1;
    const s = play(seed, [bot.chooseActions, bot.chooseActions]).inputs.p1;
    gentle += attacks(g);
    scripted += attacks(s);
    const ticks = g.filter(a => a.actionId === 'melee' || a.actionId === 'projectile').map(a => a.tick);
    for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]);
  }
  assert.ok(gentle < scripted, `gentle ${gentle} attacks vs scripted ${scripted}`);
  // an attack is followed by startup, recovery and the 8 tick hold before the next one
  assert.ok(gaps.every(gap => gap >= 8), `shortest gap ${Math.min(...gaps)}`);
});
