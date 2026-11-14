import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as arena from '../../../packages/games/action/index.js';
import { compareIds, hash } from '../../../packages/contracts/index.js';
import * as scripted from '../../../packages/games/action/bot.js';
import { buildModel, CLASSES, datasetFromRecording, evaluateModel, extractFeatures, FEATURE_NAMES, labelOf,
  makeClonedBot, MIN_MATCHES, predictClass, readiness, trainLogistic, validateModel } from './clone.js';

// Part B is prepared and tested on synthetic data (scripted-bot matches stand in for human matches). It is trained on
// real human matches only once there are enough of them (see readiness).
const sample = () => arena.initial(arena.makeConfig(arena.data, 1, ['p1', 'p2'], 300,
  { p1: 'bari', p2: 'daewi' }), arena.data);
const record = (seed, heroes = { p1: 'bari', p2: 'daewi' }, ticks = 300) => {
  const config = arena.makeConfig(arena.data, seed, ['p1', 'p2'], ticks, heroes);
  config.options = { assignments: heroes };
  let state = arena.initial(config, arena.data);
  const frames = [];
  while (arena.outcome(state).status === 'running') {
    const actions = config.players.flatMap((id, seat) => scripted.chooseActions(arena.observe(state, id),
      state.tick * 2, scripted.deriveBotSeed(seed, seat))).sort((a, b) => compareIds(a.playerId, b.playerId));
    const frame = { tick: state.tick + 1, actions, systemInputs: [] };
    frames.push(frame);
    state = arena.step(state, frame, arena.data).state;
  }
  return { config, frames };
};

test('features: a fixed-length vector of numbers in sensible ranges, from the view only', () => {
  const state = sample();
  const x = extractFeatures(arena.observe(state, 'p1'));
  assert.equal(x.length, FEATURE_NAMES.length);
  assert.ok(x.every(Number.isFinite));
  assert.equal(x[0], 1); // bias
  assert.ok(x[1] > 0 && x[1] < 1); // distance share of the arena diagonal
  assert.ok(Math.abs(x[2] ** 2 + x[3] ** 2 - 1) < 1e-9); // unit direction to the opponent
  assert.equal(extractFeatures(arena.observe(state, 'display')), null);
  const second = extractFeatures(arena.observe(state, 'p2'));
  assert.ok(Math.abs(second[2] + x[2]) < 1e-9); // the opponent sees the opposite direction
});

test('labels: the attack and the movement relative to the opponent', () => {
  const state = sample();
  const view = arena.observe(state, 'p1'); // the opponent is to the right of p1
  const act = (actionId, params = {}) => ({ playerId: 'p1', seq: 0, tick: 1, turnId: 0, actionId, params });
  const label = actions => CLASSES[labelOf(view, actions)];
  assert.equal(label([]), 'none/still');
  assert.equal(label([act('move', { moveX: 1000, moveY: 0 })]), 'none/toward');
  assert.equal(label([act('move', { moveX: -1000, moveY: 0 })]), 'none/away');
  assert.equal(label([act('move', { moveX: 0, moveY: -1000 })]), 'none/up');
  assert.equal(label([act('move', { moveX: 0, moveY: 1000 })]), 'none/down');
  assert.equal(label([act('projectile', { aimX: 1000, aimY: 0 }), act('move', { moveX: 1000, moveY: 0 })]),
    'projectile/toward');
  assert.equal(label([act('guard')]), 'guard/still');
  assert.equal(label([{ ...act('melee'), playerId: 'p2' }]), 'none/still'); // another seat's input is not mine
});

test('a dataset is rebuilt by re-simulating a recording: one row per frame, labels in range', () => {
  const recording = record(2);
  const { rows, ticks } = datasetFromRecording(recording, 'p1');
  assert.equal(rows.length, ticks);
  assert.equal(ticks, recording.frames.length);
  assert.ok(rows.every(r => r.x.length === FEATURE_NAMES.length && r.y >= 0 && r.y < CLASSES.length));
  assert.deepEqual(datasetFromRecording(recording, 'p1'), { rows, ticks }); // deterministic
  assert.notDeepEqual(datasetFromRecording(recording, 'p2').rows.map(r => r.y), rows.map(r => r.y));
});

test('logistic regression: deterministic, learns separable data, beats the majority class on bot play', () => {
  // separable by construction: class depends on the sign of one feature
  const rows = Array.from({ length: 60 }, (_, i) => {
    const x = FEATURE_NAMES.map(() => 0);
    x[0] = 1;
    x[1] = i % 2 ? 0.9 : 0.1; // distance: far -> projectile/toward, near -> melee/still
    return { x, y: i % 2 ? CLASSES.indexOf('projectile/toward') : CLASSES.indexOf('melee/still') };
  });
  const weights = trainLogistic(rows, { seed: 3, steps: 150 });
  assert.deepEqual(trainLogistic(rows, { seed: 3, steps: 150 }), weights);
  assert.notDeepEqual(trainLogistic(rows, { seed: 4, steps: 150 }), weights);
  assert.equal(evaluateModel(weights, rows).accuracy, 1);
  assert.equal(predictClass(weights, rows[0].x), rows[0].y);
  // scripted-bot play as stand-in data: a model fitted on 4 matches beats the "always the most common class" guess
  const train = [1, 2, 3, 4].flatMap(seed => datasetFromRecording(record(seed), 'p1').rows);
  const test = [5, 6].flatMap(seed => datasetFromRecording(record(seed), 'p1').rows);
  const model = trainLogistic(train, { seed: 1, steps: 120 });
  const held = evaluateModel(model, test);
  assert.ok(held.accuracy > held.majorityShare,
    `held-out accuracy ${held.accuracy} vs majority ${held.majorityShare}`);
  assert.throws(() => trainLogistic([]), /INVALID_SCHEMA/);
});

test('readiness: no model is claimed below the match threshold', () => {
  assert.equal(readiness(0).ready, false);
  assert.match(readiness(3).note, /only 3 human matches \(10 needed\): no model is trained and none is claimed/);
  assert.equal(readiness(MIN_MATCHES).ready, true);
  assert.equal(readiness(MIN_MATCHES - 1).ready, false);
});

test('the model file validates, and the cloned bot returns only legal inputs in the usual shape', () => {
  const rows = [1, 2].flatMap(seed => datasetFromRecording(record(seed), 'p1').rows);
  const weights = trainLogistic(rows, { steps: 40 });
  const model = buildModel({ weights, rows: 600, matches: 2, seed: 1, trainingAccuracy: 0.5, heldOutAccuracy: 0.4,
    dataHash: hash(arena.data), createdAt: '2026-11-14T12:00:00.000Z' });
  assert.equal(model.policy, 'cloned-lr-1');
  assert.equal(model.readiness.ready, false);
  assert.doesNotThrow(() => validateModel(model));
  for (const bad of [null, { ...model, policy: 'x' }, { ...model, weights: [] }, { ...model, weights:
    model.weights.map(r => r.slice(1)) }, { ...model, weights: model.weights.map(r => r.map(() => NaN)) }]) {
    assert.throws(() => validateModel(bad), /INVALID_SCHEMA/);
  }
  const bot = makeClonedBot(model);
  const state = sample();
  const view = arena.observe(state, 'p1');
  const inputs = bot.chooseActions(view, 4);
  assert.deepEqual(bot.chooseActions(view, 4), inputs);
  const legal = new Set(arena.legalActions(view).map(a => a.actionId));
  for (const input of inputs) {
    assert.ok(legal.has(input.actionId));
    assert.deepEqual(Object.keys(input).sort(), ['actionId', 'params', 'playerId', 'seq', 'tick', 'turnId']);
  }
  assert.deepEqual(bot.chooseActions(arena.observe(state, 'display'), 0), []);
  assert.match(bot.botPolicyVersion, /^cloned-lr-1\+600$/);
});
