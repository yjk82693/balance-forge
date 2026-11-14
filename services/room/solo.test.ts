import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer } from './test-helpers.ts';
import { validate } from '../../packages/contracts/index.ts';
import { replayOnData } from '../../packages/sim/index.ts';
import * as arena from '../../packages/games/action/index.ts';
import { hash } from '../../packages/contracts/index.ts';
import { chooseActionsGentle, deriveBotSeed } from '../../packages/games/action/bot.ts';
test('solo arena fills only the empty seat, runs the standard bot and records its seat explicitly', async t => {
  const {
    server,
    host,
    phone,
    room
  } = await localServer(t);
  phone.close();
  host.request('match.start', {
    bot: true,
    seed: 7,
    maxTicks: 50
  });
  assert.equal(room.phase, 'playing');
  const status = host.take('room.status').payload;
  assert.equal(status.seats.filter(seat => seat.bot).length, 1);
  for (let tick = 0; tick < 50; tick++) server.advance(room);
  const result = host.take('match.ended').payload.result;
  validate('MatchResult', result);
  assert.equal(result.valid, true);
  assert.deepEqual(result.botSeats, ['p2']);
  assert.equal(result.botPolicyVersion, 'scripted-0.2.1-gentle'); // the room bot is the gentle policy, and says so
  assert.ok(result.statistics.players.find(player => player.playerId === 'p2').actions.some(action => action.uses > 0));
  const recording = server.storage.getReplay(result.matchId);
  assert.equal(hash(replayOnData(arena.adapter, recording, room.authority.data)), result.finalStateHash);
  assert.deepEqual(server.storage.humans[0].botSeats, ['p2']);
  assert.equal(server.storage.humans[0].botPolicyVersion, 'scripted-0.2.1-gentle');
  host.request('match.reset', {});
  assert.equal(room.seats.length, 1);
});
test('pre-join room status exposes the actual game and playable roster without granting a seat', async t => {
  const {
    server,
    room,
    connect
  } = await localServer(t);
  const observer = connect(`?joinCode=${room.code}`),
    status = observer.take('room.status').payload;
  assert.equal(status.gameId, 'hero_arena');
  assert.deepEqual(status.playableHeroes, arena.data.characters.map(c => c.id));
  assert.equal(status.you, undefined);
  assert.equal(status.seatToken, undefined);
  const cards = server.createRoom('hero_cards');
  const cardObserver = connect(`?roomId=${cards.id}`);
  assert.equal(cardObserver.take('room.status').payload.gameId, 'hero_cards');
  assert.ok(cardObserver.take('room.status').payload.playableHeroes.includes('nightcrow'));
});
test('solo start requires a human seat and does not replace two connected humans', async t => {
  const {
    server,
    host,
    room,
    connect
  } = await localServer(t);
  host.request('match.start', {
    bot: true,
    maxTicks: 1
  });
  server.advance(room);
  assert.equal('botSeats' in host.take('match.ended').payload.result, false);
  const display = connect('?role=display');
  display.request('match.start', {
    bot: true
  });
  assert.equal(display.take('error').payload.code, 'ILLEGAL_ACTION');
});
test('solo card turns advance with the runner bot policy and retain the bot-seat marker', async t => {
  const {
    server,
    host,
    phone,
    room
  } = await localServer(t);
  phone.close();
  host.request('match.start', {
    gameId: 'hero_cards',
    bot: true
  });
  assert.equal(room.phase, 'playing');
  for (let count = 0; count < 80 && room.phase === 'playing'; count++) {
    const state = room.authority.state;
    if (state.payload.activePlayer === 'p1') host.request('input.submit', {
      playerId: 'p1',
      seq: state.tick,
      tick: state.tick + 1,
      turnId: state.turnId,
      actionId: 'end_turn',
      params: {}
    });else server.pump();
  }
  assert.equal(room.phase, 'ended');
  const result = host.take('match.ended').payload.result;
  assert.equal(result.valid, true);
  assert.deepEqual(result.botSeats, ['p2']);
  assert.equal('botPolicyVersion' in result, false); // the cards bot has no gentle policy
});

test('solo room plays the gentle policy with the same match-seeded seat variant as the runner', async t => {
  const { server, host, phone, room } = await localServer(t);
  phone.close();
  host.request('match.start', { bot: true, seed: 91, maxTicks: 20 });
  for (let tick = 0; tick < 20; tick++) {
    const expected = chooseActionsGentle(arena.observe(room.authority.state, 'p2'), tick * 2, deriveBotSeed(91, 1));
    server.advance(room);
    const actions = room.authority.frames[tick].actions.filter(input => input.playerId === 'p2');
    assert.deepEqual(actions, expected);
  }
});
