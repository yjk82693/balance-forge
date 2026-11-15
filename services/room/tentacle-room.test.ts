import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoomServer } from './server.ts';
import { LocalSocket } from './test-helpers.ts';
import { validate } from '../../packages/contracts/index.ts';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'tentacle-room-'));
  const server = createRoomServer({ storageDir: root, analysisEnv: {} });
  server.scheduler.stop();
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const connect = (query = '') => {
    const ws = new LocalSocket();
    server.connect(ws as any, new URL(`http://localhost/ws${query}`));
    return ws;
  };
  return { server, connect };
}

test('Tentacle Run in a room: Sepia only, any hero joins as Sepia, solo seat is p1, the run is recorded', async t => {
  const { server, connect } = await setup(t);
  const host = connect('?role=display&gameId=tentacle_run');
  const status = host.take('room.status').payload;
  assert.equal(status.gameId, 'tentacle_run');
  assert.deepEqual(status.playableHeroes, ['sepia']);
  const room = server.rooms.get(host.take('room.status').roomId);
  const phone = connect();
  phone.request('room.join', { joinCode: room.code, name: 'Chairman', hero: 'bari' }); // another hero: still joins
  assert.equal(phone.messages.filter(m => m.type === 'error').length, 0);
  const seated = phone.take('room.status').payload;
  assert.deepEqual(seated.seats.map(s => [s.seat, s.hero]), [['p1', 'sepia']]);
  phone.request('room.hero', { hero: 'daewi' }); // a hero change is also forced to Sepia
  assert.equal(phone.take('room.status').payload.seats[0].hero, 'sepia');
  host.request('match.start', { seed: 5, maxTicks: 120 });
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.authority.config.options.assignments, { p1: 'sepia' });
  assert.equal(room.authority.config.gameId, 'tentacle_run');
  phone.request('input.submit', { playerId: 'p1', seq: 0, tick: 1, turnId: 0, actionId: 'control',
    params: { jump: 0, slide: 1 } });
  for (let i = 0; i < 120; i++) server.advance(room);
  const result = host.take('match.ended').payload.result;
  validate('MatchResult', result);
  assert.equal(result.valid, true);
  assert.equal(result.outcome.reason, 'max_ticks');
  assert.ok(result.statistics.players[0].actions.some(a => a.actionId === 'wave:1:reached'));
  assert.ok(result.statistics.players[0].actions.find(a => a.actionId === 'control').uses >= 1);
  assert.equal('botSeats' in result, false);
  assert.ok(room.authority.state.payload.player.x > 3000); // Sepia ran on her own
  assert.equal(room.authority.state.payload.player.state, 'sliding'); // the control stayed until changed
  assert.equal(server.storage.humans.at(-1).matchId, result.matchId);
  const view = phone.take('state.view').payload.observation.payload;
  assert.equal(view.sectionCount, 6);
  assert.ok(Array.isArray(view.obstacles) && Array.isArray(view.anchors));
});

test('Tentacle Run needs exactly one seat; Hero Arena and Hero Cards rooms are unchanged', async t => {
  const { server, connect } = await setup(t);
  const host = connect('?role=display&gameId=tentacle_run');
  const room = server.rooms.get(host.take('room.status').roomId);
  host.request('match.start', { seed: 5 });
  assert.equal(room.phase, 'lobby'); // nobody seated
  const arena = connect('?role=display');
  assert.ok(arena.take('room.status').payload.playableHeroes.includes('bari'));
  const cardsRoom = connect('?role=display&gameId=hero_cards');
  assert.equal(cardsRoom.take('room.status').payload.gameId, 'hero_cards');
});
