import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bot from './bot.js';
import { data, initial, makeConfig, observe, step } from './index.js';

// These export names and their array/single-input behavior are compatibility boundaries for analysis callers.
test('bot exports keep the modern API and the deprecated attack-only alias', () => {
  assert.equal(typeof bot.chooseActions, 'function');
  assert.equal(typeof bot.chooseAction, 'function');
  const state = initial(makeConfig(data), data),
    view = observe(state, 'p1');
  const inputs = bot.chooseActions(view, 10, 0);
  assert.ok(inputs.some(input => input.actionId === 'move'));
  assert.deepEqual(bot.chooseAction(view, 10, 0), inputs.find(input => input.actionId !== 'move'));
  assert.equal(bot.chooseAction(view, 10, 0).seq, 11);
});
test('the old alias returns null when only movement is legal or the viewer has no actions', () => {
  const state = initial(makeConfig(data), data);
  const inputs = bot.chooseActions(observe(state, 'p1'), 0, 0);
  const next = step(state, {
    tick: 1,
    actions: inputs,
    systemInputs: []
  }, data).state;
  assert.deepEqual(bot.chooseActions(observe(next, 'p1'), 2, 0).map(input => input.actionId), ['move']);
  assert.equal(bot.chooseAction(observe(next, 'p1'), 2, 0), null);
  assert.equal(bot.chooseAction(observe(next, 'display'), 2, 0), null);
});
test('incoming hostile projectiles trigger a generic legal guard without changing the view', () => {
  for (const hero of data.characters) {
    const config = makeConfig(data);
    config.options.assignments.p1 = hero.id;
    const state = initial(config, data);
    const me = state.payload.entities[0];
    state.payload.projectiles.push({
      id: 'pr1', owner: 'p2', kind: 'projectile', moveId: 'projectile',
      x: me.x + 1200, y: me.y, vx: -300, vy: 0, life: 20, power: 44, ignoresGuard: false
    });
    const view = observe(state, 'p1'), before = structuredClone(view);
    assert.equal(bot.chooseAction(view, 0).actionId, 'guard');
    assert.deepEqual(view, before);
    view.payload.projectiles[0].ignoresGuard = true;
    assert.equal(bot.chooseAction(view, 0).actionId, 'guard');
    view.payload.projectiles[0].owner = 'p1';
    assert.notEqual(bot.chooseAction(view, 0).actionId, 'guard');
    view.payload.projectiles[0].owner = 'p2';
    view.payload.projectiles[0].y += 2000;
    assert.notEqual(bot.chooseAction(view, 0).actionId, 'guard');
    view.payload.projectiles[0].y -= 2000;
    view.payload.projectiles[0].vx = 300;
    assert.notEqual(bot.chooseAction(view, 0).actionId, 'guard');
    view.payload.projectiles[0].vx = -300;
    view.payload.entities[0].cooldowns[2] = 100;
    assert.notEqual(bot.chooseAction(view, 0).actionId, 'guard');
  }
  assert.equal(bot.botPolicyVersion, 'scripted-0.2.0');
});
