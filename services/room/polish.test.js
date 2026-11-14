import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { localServer, http } from './test-helpers.js';
import { writeJson } from './storage.js';
test('failed index persistence leaves the current data pin unchanged in memory and on disk', async t => {
  const {
      server,
      root
    } = await localServer(t),
    storage = server.storage;
  const original = storage.get('hero_arena'),
    indexPath = join(root, 'data', 'current.json');
  const originalIndex = await readFile(indexPath, 'utf8');
  const save = storage.saveIndex;
  storage.saveIndex = () => {
    throw Error('write failed');
  };
  const response = await http(server, '/v1/data/hero_arena/apply-patch', {
    method: 'POST',
    body: {
      proposal: {
        baseDataHash: original.dataHash,
        replacements: [{
          path: '/moves/1/power',
          value: 72
        }],
        rationale: 'test'
      }
    }
  });
  assert.equal(response.status, 503);
  assert.equal(storage.get('hero_arena').dataHash, original.dataHash);
  assert.equal(await readFile(indexPath, 'utf8'), originalIndex);
  storage.saveIndex = save;
});
test('switching games clears a selected hash from the previous game', async t => {
  const {
    server,
    host,
    room
  } = await localServer(t);
  host.request('game.select', {
    gameId: 'hero_arena',
    dataHash: server.storage.get('hero_arena').dataHash
  });
  host.request('match.start', {
    gameId: 'hero_cards'
  });
  assert.equal(room.phase, 'playing');
  assert.equal(room.selectedHash, undefined);
  host.request('match.reset', {});
  host.request('match.start', {});
  assert.equal(room.phase, 'playing');
  assert.equal(room.authority.config.gameId, 'hero_cards');
});
test('failed atomic writes remove temporary files and replay/result identity mismatches are rejected', async t => {
  const {
      server,
      host,
      room,
      root
    } = await localServer(t),
    target = join(root, 'destination');
  await mkdir(target);
  assert.throws(() => writeJson(target, {
    example: true
  }));
  assert.ok((await readdir(root)).every(name => !name.endsWith('.tmp')));
  host.request('match.start', {
    maxTicks: 1
  });
  server.advance(room);
  const result = server.storage.humans[0],
    recording = server.storage.getReplay(result.matchId);
  const changed = {
    ...result,
    matchId: 'new-result'
  };
  assert.throws(() => server.storage.record(changed, recording), /HASH_MISMATCH/);
  for (const value of [null, {
    ...recording,
    frames: null
  }, {
    ...recording,
    finalStateHash: 'invalid'
  }]) {
    assert.throws(() => server.storage.recordReplay(value), /INVALID_SCHEMA/);
  }
  assert.equal(server.storage.humans.length, 1);
});
