import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from './index.js';
import { hash, validateGamePayload } from '../../contracts/index.js';
test('nightcrow deck summons mechanical crows and reveals only the next card to its owner', () => {
  const config = game.makeConfig(game.data, 5);
  config.options = {
    assignments: {
      p1: 'nightcrow',
      p2: 'standard'
    }
  };
  const state = game.initial(config, game.data);
  assert.ok(state.payload.entities[0].deck.every(id => id !== 'sentinel'));
  const player = state.payload.entities[0];
  player.hand = ['forethought', 'mechanical_crows'];
  const expected = state.payload.entities[1].deck.at(-1),
    rng = state.rng;
  const frame = {
    tick: 1,
    actions: [{
      playerId: 'p1',
      seq: 0,
      tick: 1,
      turnId: 0,
      actionId: 'play',
      params: {
        handIndex: 0
      }
    }],
    systemInputs: []
  };
  const first = game.step(state, frame, game.data),
    second = game.step(state, frame, game.data);
  assert.equal(hash(first.state), hash(second.state));
  assert.equal(first.state.rng, rng);
  assert.equal(game.observe(first.state, 'p1').payload.peek.cardId, expected);
  assert.equal(game.observe(first.state, 'p2').payload.peek.cardId, '');
  assert.equal(game.observe(first.state, 'display').payload.peek.cardId, '');
  assert.deepEqual(first.events.find(e => e.kind === 'card.peek').audience, ['p1']);
  const summon = {
    tick: 2,
    actions: [{
      playerId: 'p1',
      seq: 1,
      tick: 2,
      turnId: 0,
      actionId: 'play',
      params: {
        handIndex: 0,
        slot: 0
      }
    }],
    systemInputs: []
  };
  const end = game.step(first.state, summon, game.data).state;
  assert.equal(end.payload.entities[0].units.length, 1);
  assert.equal(end.payload.entities[0].units[0].kind, 'mechanical_crows');
  assert.equal(end.payload.entities[0].units[0].power, 2);
  assert.equal(game.observe(end, 'p1').payload.peek.cardId, '');
  validateGamePayload('hero_cards', 1, 'state', end.payload);
});
