import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http, LocalSocket } from './test-helpers.js';
import { hash, validate } from '../../packages/contracts/index.js';
test('phone resumes within ten seconds with the same seat, hero, match and duplicate receipts', async t => {
  let now = 1000;
  const {
    server,
    host,
    phone,
    room,
    connect
  } = await localServer(t, {
    clock: () => now
  });
  const token = phone.take('room.status').payload.seatToken;
  assert.ok(token.length >= 32);
  assert.equal('token' in host.take('room.status').payload.seats[1], false);
  host.request('match.start', {
    maxTicks: 300
  });
  const matchId = room.matchId,
    config = hash(room.authority.config);
  const input = {
    playerId: 'p2',
    seq: 0,
    tick: 1,
    turnId: 0,
    actionId: 'move',
    params: {
      moveX: 1000,
      moveY: 0
    }
  };
  phone.request('input.submit', input);
  server.advance(room);
  const priorReceipt = phone.take('input.ack').payload;
  phone.close();
  assert.equal(room.seats[1].session, null);
  assert.equal(room.seats[1].expiresAt, 11000);
  for (let i = 0; i < 5; i++) server.advance(room);
  now = 10999;
  const replacement = connect();
  replacement.request('reconnect', {
    joinCode: room.code,
    seatToken: token,
    lastAck: 0
  });
  const status = replacement.take('room.status').payload;
  assert.equal(status.you, 'p2');
  assert.equal(status.seats[1].hero, 'real_armor');
  assert.notEqual(status.seatToken, token);
  assert.equal(room.matchId, matchId);
  assert.equal(hash(room.authority.config), config);
  assert.equal(replacement.take('state.view').payload.tick, 6);
  assert.deepEqual(replacement.take('input.ack').payload, priorReceipt);
  replacement.request('input.submit', input);
  assert.deepEqual(replacement.take('input.ack').payload, priorReceipt);
  replacement.request('input.submit', {
    ...input,
    seq: 1,
    tick: 7
  });
  server.advance(room);
  assert.equal(room.authority.state.payload.entities.find(e => e.id === 'p2').lastSeq, 1);
  const thief = connect();
  thief.request('reconnect', {
    joinCode: room.code,
    seatToken: token
  });
  assert.equal(thief.take('error').payload.code, 'AUTH_EXPIRED');
  assert.equal(room.seats[1].session.ws, replacement);
});
test('seat expires at exactly ten seconds and another phone cannot take it mid-match', async t => {
  let now = 0;
  const {
    host,
    phone,
    room,
    connect
  } = await localServer(t, {
    clock: () => now
  });
  const token = phone.take('room.status').payload.seatToken;
  host.request('match.start', {});
  phone.close();
  now = 10000;
  const late = connect();
  late.request('reconnect', {
    joinCode: room.code,
    seatToken: token
  });
  assert.equal(late.take('error').payload.code, 'AUTH_EXPIRED');
  assert.ok(late.take('error').payload.message.includes('expired'));
  late.request('room.join', {
    joinCode: room.code,
    name: 'Intruder',
    hero: 'sepia'
  });
  assert.equal(late.take('error').payload.code, 'ILLEGAL_ACTION');
  assert.equal(room.seats[1].token, null);
});
test('bad messages have clear errors, preserve state, and the next valid ping still succeeds', async t => {
  const {
    server,
    host,
    room
  } = await localServer(t);
  host.request('match.start', {
    gameId: 'hero_cards'
  });
  const before = hash(room.authority.state);
  for (const raw of ['{', 'null', '[]', JSON.stringify({
    type: 'input.submit'
  }), ' '.repeat(65537), JSON.stringify({
    a: Array.from({
      length: 40
    }).reduce(a => ({
      nested: a
    }), {})
  })]) {
    assert.doesNotThrow(() => host.emit('message', Buffer.from(raw), false));
    const error = host.take('error').payload;
    assert.equal(error.code, 'INVALID_SCHEMA');
    assert.ok(error.message);
    assert.equal(hash(room.authority.state), before);
  }
  host.request('toString', {});
  assert.equal(host.take('error').payload.code, 'INVALID_SCHEMA');
  host.emit('message', Buffer.from('{}'), true);
  assert.equal(host.take('error').payload.code, 'INVALID_SCHEMA');
  host.request('input.submit', {
    playerId: 'p1',
    seq: 0,
    tick: 0,
    turnId: 0,
    actionId: 'end_turn',
    params: {}
  });
  assert.equal(host.take('error').payload.code, 'LATE_INPUT');
  assert.equal(host.take('error').payload.retryable, true);
  host.request('ping', {});
  assert.ok(host.take('pong'));
  assert.equal(hash(room.authority.state), before);
  const malformed = await http(server, 'http://[');
  assert.equal(malformed.status, 400);
  assert.ok(malformed.json().message);
  const badBody = await http(server, '/v1/playtest/run', {
    method: 'POST',
    raw: '{'
  });
  assert.equal(badBody.status, 400);
  assert.equal(badBody.json().code, 'INVALID_SCHEMA');
});
test('bad upgrade, transport send failure and a transient result write failure do not escape callbacks', async t => {
  const {
    server,
    host,
    room
  } = await localServer(t);
  let destroyed = false;
  assert.doesNotThrow(() => server.http.emit('upgrade', {
    url: 'http://['
  }, {
    destroy() {
      destroyed = true;
    }
  }, Buffer.alloc(0)));
  assert.equal(destroyed, true);
  const broken = new LocalSocket();
  broken.send = () => {
    throw Error('broken pipe');
  };
  assert.doesNotThrow(() => server.connect(broken, new URL('http://localhost/ws')));
  assert.equal(broken.readyState, 3);
  const save = server.storage.record.bind(server.storage);
  server.storage.record = () => {
    throw Error('disk full');
  };
  host.request('match.start', {
    maxTicks: 1
  });
  assert.doesNotThrow(() => server.advance(room));
  assert.equal(room.phase, 'ended');
  assert.equal(server.pendingRecords.size, 1);
  assert.equal(host.take('error').payload.code, 'TRANSPORT_UNAVAILABLE');
  assert.equal(host.take('match.ended'), undefined);
  server.storage.record = save;
  assert.doesNotThrow(() => server.flushRecord(room.matchId));
  assert.equal(server.pendingRecords.size, 0);
  assert.ok(host.take('match.ended'));
  validate('MatchResult', host.take('match.ended').payload.result);
  assert.equal(server.storage.humans.length, 1);
});
test('socket-free production handlers finish and replay a 300-tick human match', async t => {
  const {
    server,
    host,
    phone,
    room
  } = await localServer(t);
  host.request('match.start', {
    maxTicks: 300,
    seed: 23
  });
  for (let tick = 1; tick <= 300; tick++) {
    for (const [ws, id, dx] of [[host, 'p1', -1000], [phone, 'p2', 1000]]) {
      // Advance rate-limit clocks without changing logical simulation time.
      const session = [...server.sessions].find(s => s.ws === ws);
      session.window -= 1000;
      ws.request('input.submit', {
        playerId: id,
        seq: tick,
        tick,
        turnId: 0,
        actionId: 'move',
        params: {
          moveX: dx,
          moveY: 0
        }
      });
    }
    server.advance(room);
  }
  const result = host.take('match.ended').payload.result;
  assert.equal(result.statistics.durationTicks, 300);
  assert.equal(result.valid, true);
  assert.equal(server.storage.humans.length, 1);
  const replay = (await http(server, `/v1/replay/${result.matchId}`)).json();
  assert.equal(replay.frames.length, 300);
  assert.ok(replay.frames.every(f => f.actions.length === 2));
  assert.equal(result.finalStateHash, hash(room.authority.state));
});
