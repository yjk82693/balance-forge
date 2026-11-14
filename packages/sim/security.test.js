import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinData } from './index.js';
import * as game from '../games/action/index.js';
import { validateData, validateGamePayload, canonicalJson } from '../contracts/index.js';
test('pinning freezes descendants even if the caller already froze the outer object', () => {
  const data = Object.freeze(structuredClone(game.data));
  pinData(data);
  assert.throws(() => {
    data.moves[0].power = 1;
  }, TypeError);
});
test('unregistered payloads and content provenance/reference errors fail closed', () => {
  assert.throws(() => validateGamePayload('unregistered', 1, 'state', {}));
  for (const modify of [data => data.characters[0].moveIds.push('missing'), data => data.moves[0].authorKey =
    'missing', data => data.moves.push({
    ...data.moves[0]
  })]) {
    const data = structuredClone(game.data);
    modify(data);
    assert.throws(() => validateData(data));
  }
});
test('canonical hash rejects sparse arrays and schema rejects inherited properties', () => {
  assert.throws(() => canonicalJson(Array(2)));
  const state = game.initial(game.makeConfig(game.data), game.data);
  const action = {
    playerId: 'p1',
    seq: 0,
    tick: 1,
    turnId: 0,
    actionId: 'guard',
    params: {
      constructor: 1
    }
  };
  assert.throws(() => game.step(state, {
    tick: 1,
    actions: [action],
    systemInputs: []
  }, game.data));
});
