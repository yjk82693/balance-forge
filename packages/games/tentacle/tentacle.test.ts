import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from './index.ts';
import * as bot from './bot.ts';
import { Authority } from '../../sim/index.ts';
import { hash } from '../../contracts/index.ts';

game.observationCheck.every = 1; // validate every view in the tests
const play = (seed: number, maxTicks = 7200, data = game.data) => {
  const config = game.makeConfig(data, seed, ['p1'], maxTicks);
  let state = game.initial(config, data);
  const v = bot.deriveBotSeed(seed, 0);
  while (game.outcome(state).status === 'running') {
    const actions = bot.chooseActions(game.observe(state, 'p1'), state.tick * 2, v);
    state = game.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
  }
  return state;
};
const act = (state, actionId, params, seq = 0) =>
  ({ playerId: 'p1', seq, tick: state.tick + 1, turnId: 0, actionId, params });
const stepWith = (state, actions = []) =>
  game.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, game.data).state;
const fresh = (seed = 1, maxTicks = 7200) =>
  game.initial(game.makeConfig(game.data, seed, ['p1'], maxTicks), game.data);

test('the data shape: 5 waves, 15 posts, one flawed wave', () => {
  const rules = game.data.gameRules;
  assert.equal(rules.waves.length, 5);
  assert.equal(rules.posts.length, 15);
  assert.deepEqual(rules.waves.map((w, i) => (w.flaw ? i + 1 : 0)).filter(Boolean), [4]);
  assert.equal(game.describe().maxPlayers, 1);
});

test('a run is deterministic: same seed, same final state hash; another seed differs', () => {
  const a = play(3, 1200), b = play(3, 1200), c = play(4, 1200);
  assert.equal(hash(a), hash(b));
  assert.notEqual(hash(a), hash(c));
  assert.equal(game.outcome(a).reason, a.payload.outcome.reason);
});

test('the break, the first wave spawns on time, observation shape and breakTicks', () => {
  let state = fresh();
  assert.equal(game.observe(state, 'p1').payload.breakTicks, game.data.gameRules.betweenWavesTicks);
  assert.equal(game.observe(state, 'p1').payload.entities.length, 1);
  for (let i = 0; i < 60; i++) state = stepWith(state);
  const view = game.observe(state, 'p1').payload;
  assert.equal(view.wave, 1);
  assert.equal(view.breakTicks, 0);
  assert.equal(view.entities.length, 1 + game.data.gameRules.waves[0].walkers);
  assert.equal(view.posts.length, 15);
  assert.equal(view.boss, null);
  assert.equal(state.payload.statistics.players[0].actions.find(a => a.actionId === 'wave:1:reached').uses, 1);
});

test('latch pulls Sepia to the nearest post in the aimed cone, with a cooldown and invulnerability', () => {
  let state = fresh();
  state.payload.player.x = 7000;
  state.payload.player.y = 4500; // post 7 is at (8000, 4500) (row 1, column 2)
  state = stepWith(state, [act(state, 'latch', { aimX: 1000, aimY: 0 })]);
  assert.equal(state.payload.player.latch.post, 7);
  assert.ok(state.payload.player.invulnerableUntilTick > state.tick);
  for (let i = 0; i < 10 && state.payload.player.latch; i++) state = stepWith(state);
  assert.deepEqual([state.payload.player.x, state.payload.player.y], [8000, 4500]);
  // cooling down: a second latch is ignored
  const again = stepWith(state, [act(state, 'latch', { aimX: 1000, aimY: 0 }, 5)]);
  assert.equal(again.payload.player.latch, null);
  // no post in the cone: nothing happens and no cooldown starts
  let empty = fresh();
  empty.payload.player.x = 8000;
  empty.payload.player.y = 4500;
  empty = stepWith(empty, [act(empty, 'latch', { aimX: 0, aimY: 0 })]);
  assert.equal(empty.payload.player.latch, null);
});

test('whip damages enemies in the aimed half plane within range, and has a cooldown', () => {
  let state = fresh();
  for (let i = 0; i < 60; i++) state = stepWith(state);
  const target = state.payload.enemies[0];
  state.payload.player.x = target.x - 1000;
  state.payload.player.y = target.y;
  const before = target.hp;
  state = stepWith(state, [act(state, 'whip', { aimX: 1000, aimY: 0 })]);
  const after = state.payload.enemies.find(e => e.id === target.id);
  assert.ok(!after || after.hp < before);
  const stat = state.payload.statistics.players[0].actions.find(a => a.actionId === 'whip');
  assert.deepEqual([stat.uses, stat.opportunities], [1, 1]);
  const second = stepWith(state, [act(state, 'whip', { aimX: 1000, aimY: 0 }, 3)]);
  assert.equal(second.payload.statistics.players[0].actions.find(a => a.actionId === 'whip').uses, 1); // cooling down
});

test('a full bot run: statistics per wave are consistent, the outcome is a win or a loss', () => {
  const state = play(2);
  const stats = state.payload.statistics.players[0].actions;
  const of = id => stats.find(a => a.actionId === id);
  for (let w = 1; w <= 6; w++) {
    const reached = of(`wave:${w}:reached`).uses, cleared = of(`wave:${w}:cleared`).uses;
    assert.ok(cleared <= reached);
    // a wave is reached after the one before fell
    if (w > 1 && reached) assert.equal(of(`wave:${w - 1}:cleared`).uses, 1);
  }
  const outcome = game.outcome(state);
  assert.ok(['death', 'boss_down', 'max_ticks'].includes(outcome.reason));
  assert.equal(outcome.status === 'win', outcome.reason === 'boss_down');
  assert.equal(state.payload.statistics.durationTicks, state.tick);
  const damage = [1, 2, 3, 4, 5, 6].reduce((sum, w) => sum + of(`wave:${w}:damage`).uses, 0);
  // hit points taken are never fewer than the hit points missing (healing between waves only adds)
  assert.ok(damage >= state.payload.player.maxHp - state.payload.player.hp);
});

test('the designed flaw: the bot almost never clears wave 4, and waves 1 to 3 are cleared', () => {
  let reached4 = 0, cleared4 = 0, early = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const stats = play(seed).payload.statistics.players[0].actions;
    const of = id => stats.find(a => a.actionId === id).uses;
    early += of('wave:1:cleared') + of('wave:2:cleared') + of('wave:3:cleared');
    reached4 += of('wave:4:reached');
    cleared4 += of('wave:4:cleared');
  }
  assert.equal(early, 36);
  assert.ok(reached4 >= 10);
  assert.ok(cleared4 / reached4 < 0.5, `wave 4 cleared ${cleared4}/${reached4}`);
});

test('through the Authority: a held move keeps Sepia walking, and bad inputs are refused', () => {
  const config = game.makeConfig(game.data, 5, ['p1'], 600);
  const authority = new Authority(game.adapter as any, config, game.data);
  authority.holdMoves = new Set(['p1']);
  authority.submit({ playerId: 'p1', seq: 0, tick: 1, turnId: 0, actionId: 'move', params: { moveX: 1000, moveY: 0 } });
  authority.advance();
  const x1 = authority.state.payload.player.x;
  authority.advance();
  authority.advance();
  assert.ok(authority.state.payload.player.x > x1 + 100); // kept moving with no new input
  assert.throws(() => authority.submit({ playerId: 'p2', seq: 0, tick: 4, turnId: 0, actionId: 'move',
    params: { moveX: 0, moveY: 0 } }), /ILLEGAL_ACTION/);
  assert.throws(() => authority.submit({ playerId: 'p1', seq: 5, tick: 4, turnId: 0, actionId: 'melee',
    params: { aimX: 0, aimY: 0 } }), /ILLEGAL_ACTION|INVALID_SCHEMA/);
});

test('the bot is deterministic per seed variant and has a personality', () => {
  const view = game.observe(fresh(), 'p1');
  assert.deepEqual(bot.chooseActions(view, 0, 5), bot.chooseActions(view, 0, 5));
  assert.match(bot.botPolicyVersion, /^tentacle-bot-/);
});
