import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from './index.ts';
import * as bot from './bot.ts';
import { hash } from '../../contracts/index.ts';

game.observationCheck.every = 1; // validate every view in the tests
const versus = (seed = 1, maxTicks = 3000) => game.initial(game.makeConfig(game.data, seed, ['p1', 'p2'], maxTicks),
  game.data);
const stepWith = (state, actions = []) =>
  game.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, game.data).state;
const control = (state, id, jump, slide, seq = 0) => ({ playerId: id, seq, tick: state.tick + 1, turnId: 0,
  actionId: 'control', params: { jump, slide } });
const playBots = (seed: number, maxTicks = 3000) => {
  let state = versus(seed, maxTicks);
  const variants = { p1: bot.deriveBotSeed(seed, 0), p2: bot.deriveBotSeed(seed, 1) };
  let seq = 0;
  while (game.outcome(state).status === 'running') {
    const actions = ['p1', 'p2'].flatMap(id => bot.chooseActions(game.observe(state, id), seq++, variants[id]));
    state = game.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, game.data).state;
  }
  return state;
};

test('solo is unchanged: the final state hashes of two bot runs match the ones before versus existed', () => {
  const solo = (seed: number) => {
    let state = game.initial(game.makeConfig(game.data, seed, ['p1'], 900), game.data);
    const v = bot.deriveBotSeed(seed, 0);
    let seq = 0;
    while (game.outcome(state).status === 'running') {
      const actions = bot.chooseActions(game.observe(state, 'p1'), seq++, v);
      state = game.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, game.data).state;
    }
    return hash(state).slice(0, 16);
  };
  assert.deepEqual([solo(3), solo(7)], ['c30f4a9138f168c1', '2efbd1cbfaa9c338']);
});

test('versus is deterministic, both seats share one course, and the statistics are per player', () => {
  const a = playBots(5), b = playBots(5), c = playBots(6);
  assert.equal(hash(a), hash(b));
  assert.notEqual(hash(a), hash(c));
  assert.deepEqual(game.initial(game.makeConfig(game.data, 5, ['p1', 'p2']), game.data).payload.obstacles,
    versus(5).payload.obstacles);
  const stats = game.statistics(a).players;
  assert.deepEqual(stats.map(p => p.playerId), ['p1', 'p2']);
  for (const p of stats) {
    assert.ok(p.actions.find(x => x.actionId === 'distance').uses > 0);
    assert.ok(p.actions.find(x => x.actionId === 'section').uses >= 1);
    assert.ok(p.actions.find(x => x.actionId === 'control').uses > 0);
  }
  assert.ok(['opponent_down', 'finish', 'max_ticks', 'draw'].includes(game.outcome(a).reason));
});

test('views: a seat sees its own runner plus the versus block, the display sees the leader and both runners', () => {
  let state = versus(2);
  for (let i = 0; i < 40; i++) state = stepWith(state);
  state.payload.runners[1].x += 9000; // p2 leads
  state.payload.runners[0].x = 500;
  const own = game.observe(state, 'p1').payload;
  assert.equal(own.versus.you, 'p1');
  assert.equal(own.versus.opponent.id, 'p2');
  assert.equal(own.player.x, 500);
  assert.equal(own.cameraX, 0);
  const display = game.observe(state, 'display').payload;
  assert.equal(display.versus.you, null);
  assert.equal(display.versus.opponent, null);
  assert.equal(display.versus.leader, 'p2');
  assert.equal(display.player.x, state.payload.runners[1].x);
  assert.deepEqual(display.versus.runners.map(r => r.id), ['p1', 'p2']);
  for (const key of ['x', 'y', 'vx', 'vy', 'state', 'height', 'wire', 'alive', 'section']) {
    assert.ok(key in display.versus.runners[0], key);
  }
  // the display window reaches back to the trailing runner
  state.payload.obstacles.push({ id: 'ob', kind: 'wall', x: 300, w: 500, y: 0, h: 1500, section: 1 });
  assert.ok(game.observe(state, 'display').payload.obstacles.some(o => o.id === 'ob'));
  assert.ok(!game.observe(state, 'p2').payload.obstacles.some(o => o.id === 'ob'));
});

test('the first death ends the match: the survivor wins with opponent_down', () => {
  let state = versus(3);
  const wall = { id: 'w', kind: 'wall', x: 0, w: 500, y: 0, h: 1500, section: 1 };
  state.payload.obstacles = [{ ...wall, x: 1000 }];
  state.payload.runners[1].x = -1500; // p2 is far behind the wall; p1 runs into it
  while (game.outcome(state).status === 'running') state = stepWith(state);
  assert.equal(game.outcome(state).reason, 'opponent_down');
  assert.deepEqual(game.outcome(state).winners, ['p2']);
  assert.equal(state.payload.runners[0].alive, false);
  assert.equal(state.payload.runners[1].alive, true);
  assert.throws(() => stepWith(state), /ILLEGAL_ACTION/);
});

test('both dying on the same tick: the one further right wins, an exact tie is a draw', () => {
  // exact tie: both run into the same wall on the same tick
  let tie = versus(4);
  tie.payload.obstacles = [{ id: 'w', kind: 'wall', x: 2000, w: 500, y: 0, h: 1500, section: 1 }];
  while (game.outcome(tie).status === 'running') tie = stepWith(tie);
  assert.equal(game.outcome(tie).status, 'draw');
  assert.equal(game.outcome(tie).reason, 'draw');
  assert.deepEqual(game.outcome(tie).winners, []);
  // p1 in section 3 (speed 32), p2 in section 1 (speed 30), walls placed so both hit on the same tick: p1 is further
  let state = versus(4);
  state.payload.runners[0].x = state.payload.bounds[2].start + 1000;
  state.payload.runners[1].x = state.payload.bounds[0].start + 1000;
  state.payload.obstacles = state.payload.runners.map((r, i) =>
    ({ id: `w${i}`, kind: 'wall', x: r.x, w: 500, y: 0, h: 1500, section: 1 }));
  while (game.outcome(state).status === 'running') state = stepWith(state);
  assert.equal(state.payload.runners.every(r => !r.alive), true);
  assert.deepEqual(game.outcome(state).winners, ['p1']);
  assert.equal(game.outcome(state).reason, 'opponent_down');
});

test('reaching the finish first wins, and the time limit goes to the one further right', () => {
  let state = versus(5);
  state.payload.obstacles = [];
  state.payload.runners[1].x = state.payload.finishX - 20;
  while (game.outcome(state).status === 'running') state = stepWith(state);
  assert.deepEqual(game.outcome(state).winners, ['p2']);
  assert.equal(game.outcome(state).reason, 'finish');
  let timed = versus(5, 50);
  timed.payload.obstacles = [];
  timed.payload.runners[0].x = 700;
  while (game.outcome(timed).status === 'running') timed = stepWith(timed);
  assert.deepEqual(game.outcome(timed).winners, ['p1']);
  assert.equal(game.outcome(timed).reason, 'max_ticks');
});

test('each seat has its own held control; a seat cannot send for the other', () => {
  let state = versus(6);
  state.payload.obstacles = [];
  state = stepWith(state, [control(state, 'p1', 0, 1), control(state, 'p2', 1, 0)]);
  assert.equal(state.payload.runners[0].state, 'sliding');
  assert.equal(state.payload.runners[1].state, 'jumping');
  state = stepWith(state);
  assert.equal(state.payload.runners[0].input.slide, 1); // kept
  assert.throws(() => stepWith(state, [control(state, 'p3', 1, 0)]), /ILLEGAL_ACTION|INVALID_SCHEMA/);
});

// controls: a press in the air without an anchor is harmless, a quick double tap hooks, seats never cross
const solo = (seed = 9) => game.initial(game.makeConfig(game.data, seed, ['p1'], 3000), game.data);
const tap = (state, jump, slide = 0) => stepWith(state, [control(state, 'p1', jump, slide, state.tick)]);
const flat = (state, anchors = []) => {
  state.payload.obstacles = [];
  state.payload.anchors = anchors;
  return state;
};

test('a second press in the air with no anchor in range changes nothing but the landing buffer', () => {
  const base = flat(solo());
  let a = base, b = structuredClone(base);
  for (const [jump, tick] of [[1, 0], [0, 1], [1, 2], [0, 3]]) { // jump, release, press again, release
    a = tap(a, jump);
    b = tap(b, tick === 2 ? 0 : jump);
  }
  for (let i = 0; i < 20; i++) { a = tap(a, 0); b = tap(b, 0); }
  const pa = a.payload.player, pb = b.payload.player;
  assert.deepEqual([pa.x, pa.y, pa.vx, pa.vy, pa.state], [pb.x, pb.y, pb.vx, pb.vy, pb.state]); // no stall, no loss
  // and a hook is still possible after the empty press: add an anchor, press again
  a.payload.anchors = [{ id: 'a', x: pa.x + 2000, y: 4500, overPit: false }];
  a = tap(a, 1);
  assert.equal(a.payload.player.state, 'swinging');
});

test('a fast double tap on the ground next to an anchor jumps, then hooks', () => {
  let state = flat(solo());
  state.payload.anchors = [{ id: 'a', x: state.payload.player.x + 2500, y: 4500, overPit: false }];
  for (const jump of [1, 0, 1]) state = tap(state, jump);
  assert.equal(state.payload.player.state, 'swinging');
  assert.equal(state.payload.player.wire.anchorId, 'a');
  let none = flat(solo()); // the same taps with no anchor: just a jump, then the landing buffer
  for (const jump of [1, 0, 1]) none = tap(none, jump);
  assert.equal(none.payload.player.state, 'jumping');
});

test('a press that found nothing leaves no buffered jump once a wire was fired later', () => {
  let state = flat(solo());
  for (const jump of [1, 0, 1, 0]) state = tap(state, jump); // empty press: buffered
  assert.ok(state.payload.player.jumpBuffer > 0);
  state.payload.anchors = [{ id: 'a', x: state.payload.player.x + 2000, y: 4500, overPit: false }];
  state = tap(state, 1);
  assert.equal(state.payload.player.jumpBuffer, 0);
});

test('seats never cross: p2 inputs do not move p1, and p1 inputs do not move p2', () => {
  const run = (p2Jumps: boolean, p1Jumps: boolean) => {
    let state = versus(8);
    state.payload.obstacles = [];
    for (let i = 0; i < 30; i++) {
      const actions = [control(state, 'p1', p1Jumps && i % 7 === 0 ? 1 : 0, 0, i),
        control(state, 'p2', p2Jumps && i % 5 === 0 ? 1 : 0, 0, i)];
      state = stepWith(state, actions);
    }
    return state.payload.runners.map(r => [r.x, r.y, r.vx, r.vy, r.state]);
  };
  assert.deepEqual(run(true, false)[0], run(false, false)[0]); // p2 jumping does not touch p1
  assert.deepEqual(run(false, true)[1], run(false, false)[1]); // p1 jumping does not touch p2
  assert.notDeepEqual(run(true, false)[1], run(false, false)[1]);
});
