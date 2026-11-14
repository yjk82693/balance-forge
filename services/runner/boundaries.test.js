import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch, runMatch, pairedJobs, rosterJobs } from './index.js';
import * as arena from '../../packages/games/action/index.js';
test('empty rosters, invalid pair selections and unknown games fail with explicit contract errors', () => {
  const empty = structuredClone(arena.data);
  empty.characters = [];
  assert.throws(() => arena.makeConfig(empty), /INVALID_SCHEMA/);
  assert.throws(() => rosterJobs({
    data: empty
  }), /INVALID_SCHEMA/);
  for (const gameId of ['missing', 'constructor', 'toString']) {
    assert.throws(() => pairedJobs({
      gameId
    }), /INVALID_SCHEMA/);
    assert.throws(() => rosterJobs({
      gameId
    }), /INVALID_SCHEMA/);
  }
  for (const options of [{
    heroes: null
  }, {
    heroes: []
  }, {
    heroes: ['missing', 'bari']
  }, {
    seeds: null
  }, {
    seeds: []
  }]) {
    assert.throws(() => pairedJobs(options), /INVALID_SCHEMA/);
  }
  assert.throws(() => pairedJobs({
    gameId: 'hero_cards',
    heroes: ['missing', 'standard']
  }), /INVALID_SCHEMA/);
});
test('malformed job boundaries reject without spawning workers or returning fabricated matches', async () => {
  assert.throws(() => runMatch(null), /INVALID_SCHEMA/);
  assert.throws(() => runMatch({
    config: {}
  }), /INVALID_SCHEMA/);
  await assert.rejects(runBatch([null]), /INVALID_SCHEMA/);
  await assert.rejects(runBatch([]), /INVALID_SCHEMA/);
  await assert.rejects(runBatch(pairedJobs({
    seeds: [1]
  }), {
    onProgress: 'invalid'
  }), /INVALID_SCHEMA/);
  const [job] = pairedJobs({
    seeds: [1]
  });
  job.config.gameId = 'constructor';
  const result = runMatch(job);
  assert.equal(result.valid, false);
  assert.equal(result.errorCode, 'INVALID_SCHEMA');
});
