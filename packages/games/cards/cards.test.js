import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from './index.js';
import { hash, validate, validateGamePayload, restoreSnapshot } from '../../contracts/index.js';
import { Authority, replay } from '../../sim/index.js';
const make = (seed = 1, data = game.data) => game.initial(game.makeConfig(data, seed), data);
const input = (state, actionId, params = {}) => ({
  playerId: state.payload.activePlayer,
  seq: state.tick,
  tick: state.tick + 1,
  turnId: state.turnId,
  actionId,
  params
});
const play = (state, actionId, params = {}, data = game.data) => game.step(state, {
  tick: state.tick + 1,
  actions: [input(state, actionId, params)],
  systemInputs: []
}, data);
test('card adapter contract: 3 energy, 5 cards, private decks, seeded shuffle', () => {
  const state = make();
  validate('GameDescriptor', game.describe());
  validate('State', state);
  validateGamePayload('hero_cards', 1, 'action:play', {
    handIndex: 0,
    slot: 0
  });
  assert.throws(() => validateGamePayload('hero_cards', 1, 'action:end_turn', {
    script: 'x'
  }));
  assert.equal(hash(state), hash(make()));
  assert.notEqual(hash(state), hash(make(2)));
  for (const e of state.payload.entities) {
    assert.equal(e.energy, 3);
    assert.equal(e.hand.length, 5);
    assert.equal(e.units.length, 0);
  }
  const view = game.observe(state, 'p1');
  validate('Observation', view);
  assert.equal(view.payload.hand.length, 5);
  assert.ok(view.payload.entities.every(e => !('hand' in e) && !('deck' in e)));
  assert.equal('rng' in view, false);
  assert.deepEqual(game.observe(state, 'display').payload.hand, []);
  assert.equal(game.legalActions(game.observe(state, 'p2')).length, 0);
  const r = play(state, 'end_turn');
  validate('StepResult', r);
  validateGamePayload('hero_cards', 1, 'state', r.state.payload);
  assert.equal(r.state.turnId, 1);
  assert.equal(r.state.payload.activePlayer, 'p2');
});
test('six rounds resolve exactly twelve turns; timeout is an authoritative frame', () => {
  let state = make();
  for (let i = 0; i < 12; i++) {
    const frame = {
      tick: state.tick + 1,
      actions: [],
      systemInputs: [{
        kind: 'system.timeout',
        playerId: state.payload.activePlayer,
        turnId: state.turnId
      }]
    };
    state = game.step(state, frame, game.data).state;
  }
  assert.equal(state.turnId, 12);
  assert.equal(state.payload.round, 6);
  assert.equal(game.outcome(state).status, 'draw');
  assert.throws(() => play(state, 'end_turn'));
});
test('energy, summon slots and rejected actions preserve full state', () => {
  let state = make();
  const e = state.payload.entities.find(e => e.id === 'p1');
  e.hand = ['sentinel', 'sentinel', 'sentinel', 'ward', 'pulse'];
  const before = hash(state);
  assert.throws(() => play(state, 'play', {
    handIndex: 0,
    slot: 1
  }));
  assert.equal(hash(state), before);
  state = play(state, 'play', {
    handIndex: 0,
    slot: 0
  }).state;
  assert.equal(state.turnId, 0);
  assert.equal(state.payload.entities[0].energy, 1);
  assert.throws(() => play(state, 'play', {
    handIndex: 0,
    slot: 1
  }));
  state.payload.entities[0].energy = 3;
  state = play(state, 'play', {
    handIndex: 0,
    slot: 1
  }).state;
  assert.equal(state.payload.entities[0].units.length, 2);
  state.payload.entities[0].energy = 3;
  assert.throws(() => play(state, 'play', {
    handIndex: 0,
    slot: 0
  }));
});
test('hypnosis bypasses ward by data and sleeps enemy summons for their next turn', () => {
  const scenario = (id, data = game.data) => {
    let state = make(1, data);
    state.payload.entities[0].hand = [id];
    state.payload.entities[1].ward = 5;
    state.payload.entities[1].units = [{
      id: 'u-test',
      power: 2,
      sleepUntil: 0
    }];
    const result = play(state, 'play', {
      handIndex: 0
    }, data);
    validate('StepResult', result);
    return result.state;
  };
  const hypnosis = scenario('hypnosis'),
    spark = scenario('spark');
  assert.equal(hypnosis.payload.entities[1].hp, 16);
  assert.equal(hypnosis.payload.entities[1].ward, 5);
  assert.equal(hypnosis.payload.entities[1].units[0].sleepUntil, 2);
  assert.equal(spark.payload.entities[1].hp, 20);
  assert.equal(spark.payload.entities[1].ward, 2);
  let state = play(hypnosis, 'end_turn').state;
  state = play(state, 'end_turn').state;
  assert.equal(state.payload.entities[0].hp, 20);
  const changed = structuredClone(game.data);
  changed.gameRules.cards.find(c => c.id === 'hypnosis').ignoresWard = false;
  assert.equal(scenario('hypnosis', changed).payload.entities[1].hp, 20);
});
test('turn/seat/empty/forged timeout rejection and snapshot continuation', () => {
  const state = make(),
    before = hash(state),
    a = input(state, 'end_turn');
  for (const frame of [{
    tick: 1,
    actions: [],
    systemInputs: []
  }, {
    tick: 1,
    actions: [{
      ...a,
      playerId: 'p2'
    }],
    systemInputs: []
  }, {
    tick: 1,
    actions: [{
      ...a,
      turnId: 1
    }],
    systemInputs: []
  }, {
    tick: 1,
    actions: [a],
    systemInputs: [{
      kind: 'system.timeout',
      playerId: 'p1',
      turnId: 0
    }]
  }]) assert.throws(() => game.step(state, frame, game.data));
  assert.equal(hash(state), before);
  const restored = restoreSnapshot({
    config: state.payload.config,
    tick: 0,
    state,
    stateHash: hash(state)
  }, state.payload.config);
  assert.equal(hash(play(restored, 'end_turn').state), hash(play(state, 'end_turn').state));
});
test('card full-game scripted replay and authoritative duplicate receipt', () => {
  const config = game.makeConfig(game.data, 77),
    server = new Authority(game.adapter, config, game.data);
  while (game.outcome(server.state).status === 'running') {
    const state = server.state,
      id = state.payload.activePlayer,
      view = game.observe(state, id),
      e = view.payload.entities.find(e => e.id === id);
    const index = view.payload.hand.findIndex(c => c.cost <= e.energy && (c.kind !== 'summon' || e.units.length < 2));
    const a = index < 0 ? input(state, 'end_turn') : input(state, 'play', {
      handIndex: index,
      ...(view.payload.hand[index].kind === 'summon' ? {
        slot: e.units.length
      } : {})
    });
    assert.deepEqual(server.submit(a), server.submit(a));
    server.advance();
    validateGamePayload('hero_cards', 1, 'state', server.state.payload);
  }
  assert.ok(server.state.turnId <= 12);
  assert.equal(hash(replay(game.adapter, config, game.data, server.frames)), hash(server.state));
});
