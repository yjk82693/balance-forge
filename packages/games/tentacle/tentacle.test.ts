import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from './index.ts';
import * as bot from './bot.ts';
import { Authority } from '../../sim/index.ts';
import { hash } from '../../contracts/index.ts';

game.observationCheck.every = 1; // validate every view in the tests
const control = (state, jump, slide, seq = 0) => ({ playerId: 'p1', seq, tick: state.tick + 1, turnId: 0,
  actionId: 'control', params: { jump, slide } });
const stepWith = (state, actions = []) =>
  game.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, game.data).state;
const fresh = (seed = 1, maxTicks = 9000) =>
  game.initial(game.makeConfig(game.data, seed, ['p1'], maxTicks), game.data);
const play = (seed: number, maxTicks = 9000, data = game.data) => {
  const config = game.makeConfig(data, seed, ['p1'], maxTicks);
  let state = game.initial(config, data);
  const v = bot.deriveBotSeed(seed, 0);
  let seq = 0;
  while (game.outcome(state).status === 'running') {
    const actions = bot.chooseActions(game.observe(state, 'p1'), seq++, v);
    state = game.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
  }
  return state;
};
const runTo = (state, x: number) => {
  let s = state;
  while (s.payload.player.x < x && game.outcome(s).status === 'running') s = stepWith(s);
  return s;
};

test('the data shape: six sections, one flawed section, a generated course', () => {
  const rules = game.data.gameRules;
  assert.equal(rules.sections.length, 6);
  assert.deepEqual(rules.sections.map((s, i) => (s.flaw ? i + 1 : 0)).filter(Boolean), [4]);
  const state = fresh();
  const kinds = state.payload.obstacles.reduce((n, o) => ({ ...n, [o.kind]: (n[o.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { pit: 15, lowBar: 12, wall: 9 }); // the sum over the six sections
  assert.ok(state.payload.anchors.length > 20);
  assert.equal(state.payload.finishX, rules.leadIn + 6 * 30000);
  assert.equal(game.describe().maxPlayers, 1);
});

test('a run is deterministic: same seed same final state; another seed another course', () => {
  const a = play(3, 600), b = play(3, 600), c = play(4, 600);
  assert.equal(hash(a), hash(b));
  assert.notEqual(hash(a), hash(c));
  assert.notDeepEqual(fresh(1).payload.obstacles, fresh(2).payload.obstacles);
});

test('observation: camera, the visible window, player state and the shark in the last section', () => {
  let state = fresh();
  for (let i = 0; i < 100; i++) state = stepWith(state);
  const view = game.observe(state, 'p1').payload;
  assert.equal(view.section, 1);
  assert.equal(view.cameraX, Math.max(0, view.player.x - 4000));
  assert.equal(view.player.state, 'running');
  assert.ok(view.obstacles.every(o => o.x + o.w >= view.cameraX - 1000 && o.x <= view.cameraX + 17000));
  assert.equal(view.shark, null);
  state.payload.player.x = state.payload.bounds[5].start + 100;
  assert.deepEqual(game.observe(state, 'p1').payload.shark, { x: state.payload.player.x - 5000 });
});

test('jump: a tap leaves the ground and lands; slide: held on the ground lowers Sepia', () => {
  let state = fresh();
  state.payload.obstacles = [];
  state = stepWith(state, [control(state, 1, 0)]);
  assert.equal(state.payload.player.state, 'jumping');
  state = stepWith(state, [control(state, 0, 0, 1)]);
  let apex = 0;
  for (let i = 0; i < 80; i++) {
    state = stepWith(state);
    apex = Math.max(apex, state.payload.player.y);
  }
  assert.ok(apex > 900 && apex < 1100, `apex ${apex}`);
  assert.equal(state.payload.player.state, 'running');
  state = stepWith(state, [control(state, 0, 1, 2)]);
  assert.equal(state.payload.player.state, 'sliding');
  assert.equal(state.payload.player.height, 500);
  state = stepWith(state, [control(state, 0, 0, 3)]);
  assert.equal(state.payload.player.state, 'running');
});

test('obstacles: a pit kills a runner, a low bar kills a runner but not a slider, a wall kills a runner', () => {
  const at = (kind, x, slide = 0) => {
    let state = fresh();
    const o = state.payload.obstacles.find(item => item.kind === kind);
    state.payload.obstacles = [o];
    state.payload.player.x = o.x - 600;
    if (slide) state = stepWith(state, [control(state, 0, 1)]);
    return runTo(state, o.x + o.w + 1000);
  };
  assert.equal(at('pit', 0).payload.outcome.reason, 'pit');
  assert.equal(at('lowBar', 0).payload.outcome.reason, 'obstacle');
  assert.equal(at('lowBar', 0, 1).payload.outcome.status, 'running'); // slid under it
  assert.equal(at('wall', 0).payload.outcome.reason, 'obstacle');
});

test('the wire: jump held in the air near an anchor attaches and swings, release lets go with momentum', () => {
  let state = fresh();
  state.payload.obstacles = [];
  state.payload.anchors = [{ id: 'a0', x: 6000, y: 4500, section: 1 }];
  state.payload.player.x = 4400;
  state = stepWith(state, [control(state, 1, 0)]); // jump and keep holding
  let attached = false;
  for (let i = 0; i < 40 && !attached; i++) {
    state = stepWith(state);
    attached = state.payload.player.state === 'swinging';
  }
  assert.equal(attached, true);
  assert.equal(state.payload.player.wire.anchorId, 'a0');
  for (let i = 0; i < 5; i++) state = stepWith(state);
  const before = state.payload.player.vx;
  state = stepWith(state, [control(state, 0, 0, 1)]); // release
  assert.equal(state.payload.player.state, 'jumping');
  assert.equal(state.payload.player.wire, null);
  assert.ok(Math.abs(state.payload.player.vx - before) < 60);
  // without an anchor in reach nothing attaches
  let bare = fresh();
  bare.payload.obstacles = [];
  bare.payload.anchors = [];
  bare = stepWith(bare, [control(bare, 1, 0)]);
  for (let i = 0; i < 40; i++) bare = stepWith(bare);
  assert.notEqual(bare.payload.player.state, 'swinging');
});

test('statistics: reached and cleared per section, consistent with the outcome', () => {
  const state = play(2);
  const stats = state.payload.statistics.players[0].actions;
  const of = id => stats.find(a => a.actionId === id);
  for (let w = 1; w <= 6; w++) {
    const reached = of(`wave:${w}:reached`).uses, cleared = of(`wave:${w}:cleared`).uses;
    assert.ok(cleared <= reached);
    if (w > 1 && reached) assert.equal(of(`wave:${w - 1}:cleared`).uses, 1);
  }
  const outcome = game.outcome(state);
  assert.ok(['pit', 'obstacle', 'finish', 'max_ticks'].includes(outcome.reason));
  assert.equal(outcome.status === 'win', outcome.reason === 'finish');
  assert.equal(state.payload.statistics.durationTicks, state.tick);
});

test('the designed flaw: the bot clears sections 1 to 3 mostly and almost never section 4', () => {
  const tally = Array.from({ length: 7 }, () => [0, 0]);
  for (let seed = 1; seed <= 12; seed++) {
    const stats = play(seed).payload.statistics.players[0].actions;
    for (let w = 1; w <= 6; w++) {
      tally[w][0] += stats.find(a => a.actionId === `wave:${w}:reached`).uses;
      tally[w][1] += stats.find(a => a.actionId === `wave:${w}:cleared`).uses;
    }
  }
  assert.equal(tally[1][1], 12);
  assert.ok(tally[2][1] >= 9 && tally[3][1] >= 6, JSON.stringify(tally));
  assert.ok(tally[4][0] > 0 && tally[4][1] / tally[4][0] < 0.4, JSON.stringify(tally));
});

test('through the Authority: the control input is kept until a new one arrives', () => {
  const config = game.makeConfig(game.data, 5, ['p1'], 600);
  const authority = new Authority(game.adapter as any, config, game.data);
  authority.state.payload.obstacles = [];
  authority.submit({ playerId: 'p1', seq: 0, tick: 1, turnId: 0, actionId: 'control', params: { jump: 0, slide: 1 } });
  authority.advance();
  authority.advance();
  authority.advance();
  assert.equal(authority.state.payload.player.state, 'sliding'); // kept sliding with no new input
  assert.throws(() => authority.submit({ playerId: 'p2', seq: 0, tick: 4, turnId: 0, actionId: 'control',
    params: { jump: 0, slide: 0 } }), /ILLEGAL_ACTION/);
  assert.throws(() => authority.submit({ playerId: 'p1', seq: 5, tick: 4, turnId: 0, actionId: 'control',
    params: { jump: 2, slide: 0 } }), /ILLEGAL_ACTION|INVALID_SCHEMA/);
});

test('the bot is deterministic per seed variant', () => {
  const view = game.observe(fresh(), 'p1');
  assert.deepEqual(bot.chooseActions(view, 0, 5), bot.chooseActions(view, 0, 5));
  assert.match(bot.botPolicyVersion, /^tentacle-bot-/);
});
