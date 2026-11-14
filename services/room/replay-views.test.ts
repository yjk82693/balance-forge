import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http } from './test-helpers.ts';
import { replayViews, MAX_REPLAY_BYTES } from './replay-views.ts';
import { replayOnData } from '../../packages/sim/index.ts';
import * as arena from '../../packages/games/action/index.ts';
import { hash } from '../../packages/contracts/index.ts';
test('sampled replay views expose deterministic observations/events on both retained content versions', async t => {
  const {
    server,
    host,
    room
  } = await localServer(t);
  host.request('match.start', {
    seed: 5,
    maxTicks: 20
  });
  host.request('input.submit', {
    playerId: 'p1',
    seq: 0,
    tick: 1,
    turnId: 0,
    actionId: 'projectile',
    params: {
      aimX: 0,
      aimY: -1000
    }
  });
  for (let tick = 0; tick < 20; tick++) server.advance(room);
  const original = await http(server, `/v1/replay/${room.matchId}/views?every=6`);
  assert.equal(original.status, 200);
  const before = original.json();
  assert.deepEqual(before.views.map(view => view.tick), [0, 6, 12, 18, 20]);
  assert.ok(before.views.flatMap(view => view.events).some(event => event.kind === 'projectile.spawn'));
  assert.ok(before.views.every(view => !('rng' in view.observation) && !('config' in view.observation.payload)));
  assert.ok(Buffer.byteLength(JSON.stringify(before)) <= MAX_REPLAY_BYTES);
  const candidate = server.storage.patch('hero_arena', {
    baseDataHash: before.dataHash,
    replacements: [{
      path: '/moves/1/power',
      value: 72
    }],
    rationale: 'test'
  });
  const after = (await http(server, `/v1/replay/${room.matchId}/views?dataHash=${candidate.dataHash}&every=6`)).json();
  assert.equal(after.dataHash, candidate.dataHash);
  assert.equal(after.sourceDataHash, before.dataHash);
  assert.notEqual(after.finalStateHash, before.finalStateHash);
  assert.deepEqual(after, replayViews(server.storage, room.matchId, {
    dataHash: candidate.dataHash,
    every: 6
  }));
  assert.equal((await http(server, `/v1/replay/${room.matchId}/views?every=0`)).status, 400);
  assert.equal((await http(server, '/v1/replay/missing/views')).status, 404);
});
test('replay observers cannot mutate playback and oversized sampling is explicitly bounded', async t => {
  const {
    server,
    host,
    room
  } = await localServer(t);
  host.request('match.start', {
    maxTicks: 2
  });
  server.advance(room);
  server.advance(room);
  const recording = server.storage.getReplay(room.matchId);
  const final = replayOnData(arena.adapter, recording, arena.data, {
    onStep: ({
      state
    }) => {
      state.tick = 999;
    }
  });
  assert.equal(hash(final), recording.finalStateHash);
  const oversized = {
    ...recording,
    matchId: 'oversized',
    frames: Array(1800).fill(recording.frames[0])
  };
  server.storage.recordReplay(oversized);
  assert.equal((await http(server, '/v1/replay/oversized/views?every=1')).status, 429);
});
