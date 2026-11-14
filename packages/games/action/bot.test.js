import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bot from './bot.js';
import { data, initial, makeConfig, observe, step } from './index.js';

// These export names and their array/single-input behavior are compatibility boundaries for analysis callers.
test('bot exports keep the modern API and the deprecated attack-only alias', () => {
  assert.equal(typeof bot.chooseActions, 'function');
  assert.equal(typeof bot.chooseAction, 'function');
  const state = initial(makeConfig(data), data), view = observe(state, 'p1');
  const inputs = bot.chooseActions(view, 10, 0);
  assert.ok(inputs.some(input => input.actionId === 'move'));
  assert.deepEqual(bot.chooseAction(view, 10, 0), inputs.find(input => input.actionId !== 'move'));
  assert.equal(bot.chooseAction(view, 10, 0).seq, 11);
});

test('the old alias returns null when only movement is legal or the viewer has no actions', () => {
  const state = initial(makeConfig(data), data);
  const inputs = bot.chooseActions(observe(state, 'p1'), 0, 0);
  const next = step(state, { tick: 1, actions: inputs, systemInputs: [] }, data).state;
  assert.deepEqual(bot.chooseActions(observe(next, 'p1'), 2, 0).map(input => input.actionId), ['move']);
  assert.equal(bot.chooseAction(observe(next, 'p1'), 2, 0), null);
  assert.equal(bot.chooseAction(observe(next, 'display'), 2, 0), null);
});
