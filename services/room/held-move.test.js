import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer } from './test-helpers.js';
import { Authority, replay } from '../../packages/sim/index.js';
import * as arena from '../../packages/games/action/index.js';
// Held movement: a seat's last non-zero move vector is re-sent by the server on ticks with no new move from that seat.
const config = (seed = 1) => arena.makeConfig(arena.data, seed, ['p1', 'p2']);
const make = (held = ['p1']) => {
  const authority = new Authority(arena.adapter, config(), arena.data);
  authority.holdMoves = new Set(held);
  return authority;
};
let seq = 0;
const send = (authority, playerId, actionId, params) => authority.submit({
  playerId, seq: seq++, tick: authority.state.tick + 1, turnId: 0, actionId, params
});
const move = (authority, moveX, moveY = 0) => send(authority, 'p1', 'move', { moveX, moveY });
const moves = frame => frame.actions.filter(a => a.playerId === 'p1' && a.actionId === 'move');
const xOf = (authority, id = 'p1') => authority.state.payload.entities.find(e => e.id === id).x;

test('one move input followed by silence keeps the hero moving on every tick', () => {
  seq = 0;
  const authority = make();
  const xs = [xOf(authority)];
  move(authority, 1000);
  for (let tick = 0; tick < 6; tick++) {
    authority.advance();
    xs.push(xOf(authority));
  }
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `tick ${i} moved: ${xs.join()}`);
  assert.equal(new Set(xs.slice(1).map((x, i) => x - xs[i])).size, 1, 'same step on every tick');
  for (const frame of authority.frames) assert.equal(moves(frame).length, 1);
  assert.equal(authority.receipts.size, 1, 'injected moves make no receipts');
});

test('a (0,0) move stops the hero and clears the hold', () => {
  seq = 0;
  const authority = make();
  move(authority, 1000);
  authority.advance();
  authority.advance();
  move(authority, 0, 0);
  authority.advance();
  const stopped = xOf(authority);
  authority.advance();
  authority.advance();
  assert.equal(xOf(authority), stopped);
  assert.equal(moves(authority.frames[3]).length, 0);
  assert.equal(authority.held.size, 0);
});

test('a new move vector replaces the held one', () => {
  seq = 0;
  const authority = make();
  move(authority, 1000);
  authority.advance();
  move(authority, -1000);
  authority.advance();
  authority.advance();
  assert.deepEqual(moves(authority.frames[2])[0].params, { moveX: -1000, moveY: 0 });
});

test('the held move never carries an attack, and an attack keeps the sequence numbers valid', () => {
  seq = 0;
  const authority = make();
  move(authority, 1000);
  authority.advance();
  send(authority, 'p1', 'melee', { aimX: 1000, aimY: 0 });
  authority.advance();
  authority.advance();
  authority.advance();
  const attacks = authority.frames.flatMap(f => f.actions.filter(a => a.actionId !== 'move'));
  assert.equal(attacks.length, 1);
  assert.deepEqual(moves(authority.frames[1]).length, 1);
  assert.ok(moves(authority.frames[1])[0].seq < attacks[0].seq);
  assert.equal(moves(authority.frames[3]).length, 1);
  const next = send(authority, 'p1', 'move', { moveX: 1000, moveY: 0 }); // the phone's own next seq is still accepted
  assert.equal(next.status, 'accepted');
});

test('a stunned seat stops holding', () => {
  seq = 0;
  const authority = make();
  move(authority, 1000);
  authority.advance();
  authority.state.payload.entities.find(e => e.id === 'p1').stunUntil = authority.state.tick + 5;
  const before = xOf(authority);
  authority.advance();
  assert.equal(xOf(authority), before);
  assert.equal(authority.held.size, 0);
  assert.equal(moves(authority.frames.at(-1)).length, 0);
});

test('bots and seats outside holdMoves are not held; match end clears the hold', () => {
  seq = 0;
  const bot = make([]);
  move(bot, 1000);
  bot.advance();
  bot.advance();
  assert.equal(moves(bot.frames[1]).length, 0);
  const short = new Authority(arena.adapter, arena.makeConfig(arena.data, 1, ['p1', 'p2'], 2), arena.data);
  short.holdMoves = new Set(['p1']);
  move(short, 1000);
  short.advance();
  assert.equal(short.held.size, 1);
  short.advance(); // maxTicks reached: the match is over
  assert.notEqual(short.adapter.outcome(short.state).status, 'running');
  assert.equal(short.held.size, 0);
});

test('replaying a match with held moves reproduces its final hash', () => {
  seq = 0;
  const authority = make();
  move(authority, 1000, 300);
  for (let tick = 0; tick < 10; tick++) authority.advance();
  move(authority, -500, 0);
  for (let tick = 0; tick < 10; tick++) authority.advance();
  const replayed = replay(arena.adapter, authority.config, authority.data, authority.frames);
  assert.equal(arena.hash(replayed), arena.hash(authority.state));
  assert.equal(authority.frames.filter(f => moves(f).length).length, 20);
});

test('room: a held stick keeps moving without new input, and a disconnect stops it', async t => {
  const { server, host, phone, room } = await localServer(t);
  host.request('match.start', { seed: 3, maxTicks: 200 });
  assert.equal(room.phase, 'playing');
  const xOfSeat = id => room.authority.state.payload.entities.find(e => e.id === id).x;
  phone.request('input.submit', { playerId: 'p2', seq: 0, tick: 1, turnId: 0, actionId: 'move',
    params: { moveX: -1000, moveY: 0 } });
  const xs = [xOfSeat('p2')];
  for (let tick = 0; tick < 5; tick++) {
    server.advance(room);
    xs.push(xOfSeat('p2'));
  }
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] < xs[i - 1], `moved every tick: ${xs.join()}`);
  assert.equal(room.authority.held.has('p2'), true);
  phone.close();
  assert.equal(room.authority.held.has('p2'), false);
  const stopped = xOfSeat('p2');
  server.advance(room);
  server.advance(room);
  assert.equal(xOfSeat('p2'), stopped);
});
