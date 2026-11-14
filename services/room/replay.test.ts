import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http } from './test-helpers.ts';
import { replayOnData } from '../../packages/sim/index.ts';
import * as arena from '../../packages/games/action/index.ts';
import { hash, applyPatch } from '../../packages/contracts/index.ts';
import { runBatch, pairedJobs } from '../runner/index.ts';
test('human replay endpoint persists seed and only accepted frames, playable on retained data versions', async t => {
  const {
    server,
    host,
    room
  } = await localServer(t);
  host.request('match.start', {
    seed: 47,
    maxTicks: 20
  });
  host.request('input.submit', {
    playerId: 'p1',
    seq: 1,
    tick: 0,
    turnId: 0,
    actionId: 'move',
    params: {
      moveX: 1,
      moveY: 0
    }
  });
  assert.equal(host.take('error').payload.code, 'LATE_INPUT');
  host.request('input.submit', {
    playerId: 'p1',
    seq: 1,
    tick: 1,
    turnId: 0,
    actionId: 'projectile',
    params: {
      aimX: 0,
      aimY: -1000
    }
  });
  for (let i = 0; i < 20; i++) server.advance(room);
  const route = await http(server, `/v1/replay/${room.matchId}`),
    recording = route.json();
  assert.equal(route.status, 200);
  assert.equal(recording.seed, 47);
  assert.equal(recording.frames.length, 20);
  assert.equal(recording.frames.flatMap(f => f.actions).length, 1);
  const base = room.authority.data,
    candidate = applyPatch(base, {
      baseDataHash: hash(base),
      replacements: [{
        path: '/moves/1/power',
        value: 72
      }],
      rationale: 'replay'
    });
  assert.equal(hash(replayOnData(arena.adapter, recording, base)), recording.finalStateHash);
  assert.equal(hash(replayOnData(arena.adapter, recording, candidate)), hash(replayOnData(arena.adapter, recording,
    candidate)));
  assert.equal((await http(server, '/v1/replay/unknown')).status, 404);
  assert.equal(server.storage.getReplay(room.matchId).frames.length, 20);
});
test('worker replay capture preserves MatchResult shape and reproduces final state', async () => {
  const batch = await runBatch(pairedJobs({
    seeds: [14]
  }), {
    workers: 2,
    captureReplays: true
  });
  assert.equal(batch.replays.length, 2);
  for (let i = 0; i < 2; i++) assert.equal(hash(replayOnData(arena.adapter, batch.replays[i], arena.data)),
    batch.results[i].finalStateHash);
  assert.equal('frames' in batch.results[0], false);
});
