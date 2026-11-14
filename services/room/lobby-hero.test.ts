import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer } from './test-helpers.ts';

// The phone shows Real Armor, the seat was created as Bari: the match must play and record Real Armor.
test('room.hero changes the seat hero in the lobby and the match plays and records it', async t => {
  const { server, host, phone, room } = await localServer(t);
  const status = host.take('room.status').payload;
  assert.equal(status.seats[1].hero, 'real_armor'); // the phone joined as Real Armor in the helper
  phone.request('room.hero', { hero: 'sepia' });
  const changed = host.take('room.status').payload;
  assert.equal(changed.seats.find(seat => seat.seat === 'p2').hero, 'sepia');
  host.request('room.hero', { hero: 'daewi' });
  host.request('match.start', { seed: 5, maxTicks: 5 });
  assert.deepEqual(room.authority.config.options.assignments, { p1: 'daewi', p2: 'sepia' });
  for (let i = 0; i < 5; i++) server.advance(room);
  const result = host.take('match.ended').payload.result;
  assert.deepEqual(result.config.options.assignments, { p1: 'daewi', p2: 'sepia' });
});

test('room.hero refuses an unknown hero, a seatless session and a running match', async t => {
  const { host, phone, room, connect } = await localServer(t);
  phone.request('room.hero', { hero: 'nobody' });
  assert.equal(phone.take('error').payload.code, 'INVALID_SCHEMA');
  const stranger = connect();
  stranger.request('room.hero', { hero: 'bari' });
  assert.equal(stranger.take('error').payload.code, 'AUTH_EXPIRED');
  host.request('match.start', { seed: 5, maxTicks: 50 });
  phone.request('room.hero', { hero: 'bari' });
  assert.equal(phone.take('error').payload.code, 'ILLEGAL_ACTION');
  assert.equal(room.authority.config.options.assignments.p2, 'real_armor');
});

test('every match without a seed gets a fresh one, recorded in the config', async t => {
  const { server, host, room } = await localServer(t);
  const seeds = [];
  for (let i = 0; i < 4; i++) {
    host.request('match.start', { maxTicks: 2 });
    seeds.push(room.authority.config.seed);
    for (let tick = 0; tick < 2; tick++) server.advance(room);
    host.request('match.reset', {});
  }
  assert.equal(new Set(seeds).size, 4, `seeds ${seeds}`);
  assert.ok(seeds.every(seed => Number.isInteger(seed) && seed >= 1 && seed <= 4294967295));
  host.request('match.start', { seed: 91, maxTicks: 2 });
  assert.equal(room.authority.config.seed, 91); // an explicit seed is still honoured
});
