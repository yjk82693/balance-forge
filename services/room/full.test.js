import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validate } from '../../packages/contracts/index.js';
import { localServer, http } from './test-helpers.js';
const fullAvailable = existsSync(new URL('../../packages/analysis/pipeline/full.js', import.meta.url));
test('full playtest awaits the real analysis module rather than fabricating dashboard reports', async t => {
  const {
    server
  } = await localServer(t);
  if (fullAvailable) {
    const pipeline = await import('../../packages/analysis/pipeline/full.js');
    assert.equal(typeof pipeline.runFull, 'function');
    return;
  }
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST',
    body: {
      gameId: 'hero_arena'
    }
  });
  assert.equal(response.status, 503);
  assert.equal(response.json().code, 'TRANSPORT_UNAVAILABLE');
  assert.equal(server.runningBatch, false);
});
test('full playtest streams baseline and disjoint holdout phases into the shared response', {
  todo: fullAvailable ? false : 'Waiting for packages/analysis/pipeline/full.js as explicitly requested.'
}, async t => {
  if (!fullAvailable) return;
  const {
    server,
    host,
    room
  } = await localServer(t);
  host.request('match.start', {
    maxTicks: 1
  });
  server.advance(room);
  const originalHash = server.storage.get('hero_arena').dataHash;
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 2,
      holdoutPairs: 2,
      roster: true
    }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.proposal.origin, 'fake');
  assert.equal(body.validation.ok, true);
  validate('Report', body.baseline);
  validate('Report', body.patched);
  assert.equal(body.humanMatches, 1);
  assert.equal(body.baseline.humanMatches, 1);
  assert.ok(body.proposal.changes.every(change => typeof change.old === 'number' && typeof change.new === 'number'));
  assert.equal(server.storage.get('hero_arena').dataHash, originalHash);
  assert.equal(server.storage.get('hero_arena', body.patchedDataHash).dataHash, body.patchedDataHash);
  const records = async phase => JSON.parse(await readFile(join(server.storage.directory, 'playtests',
    `${body.runId}-${phase}.json`), 'utf8'));
  const baseline = await records('baseline'),
    holdout = await records('holdout');
  assert.equal(baseline.length, 60);
  assert.equal(holdout.length, 60);
  const baselineSeeds = new Set(baseline.map(result => result.config.seed));
  assert.ok(holdout.every(result => !baselineSeeds.has(result.config.seed)));
  for (const [phase, results] of [['baseline', baseline], ['holdout', holdout]]) {
    const final = host.messages.filter(message => message.type === 'playtest.progress' &&
      message.payload.phase === phase).at(-1).payload;
    assert.equal(final.matchesDone, results.length);
    assert.equal(final.matchups.length, 15);
    assert.equal(body.seatWins[phase], results.filter(result => result.outcome.winners.includes(result.config.players[
      0])).length);
  }
  assert.notEqual(body.baseline.dataHash, body.patchedDataHash);
  assert.ok(['accepted', 'rejected', 'inconclusive'].includes(body.verdict.verdict));
  const phases = new Set(host.messages.filter(e => e.type === 'playtest.progress').map(e => e.payload.phase));
  assert.deepEqual([...phases].sort(), ['baseline', 'holdout']);
});
test('run endpoint accepts roster scans and an explicit retained content pin', async t => {
  const {
      server
    } = await localServer(t),
    original = server.storage.get('hero_arena');
  server.storage.patch('hero_arena', {
    baseDataHash: original.dataHash,
    replacements: [{
      path: '/moves/1/power',
      value: 72
    }],
    rationale: 'test'
  });
  const response = await http(server, '/v1/playtest/run', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 1,
      roster: true,
      dataHash: original.dataHash
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().matchCount, 30);
  assert.equal(response.json().dataHash, original.dataHash);
});
test('playtest boundaries reject unknown fields, invalid pins and unsupported full game IDs', async t => {
  const {
    server
  } = await localServer(t);
  for (const body of [{
    gameId: 'hero_arena',
    pairs: 0
  }, {
    gameId: 'hero_arena',
    roster: 'yes'
  }, {
    gameId: 'hero_cards'
  }, {
    gameId: 'hero_arena',
    code: 'no'
  }]) {
    assert.equal((await http(server, '/v1/playtest/full', {
      method: 'POST',
      body
    })).status, 400);
  }
  assert.equal((await http(server, '/v1/playtest/run', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 1,
      dataHash: 'bad'
    }
  })).status, 400);
  assert.equal(server.runningBatch, false);
});
test('full playtest accepts a retained data pin and preserves numeric seat-win summaries', async t => {
  const { server } = await localServer(t);
  const original = server.storage.get('hero_arena');
  const changed = server.storage.patch('hero_arena', {
    baseDataHash: original.dataHash,
    replacements: [{ path: '/moves/1/power', value: 72 }],
    rationale: 'Retained-version test'
  });
  assert.notEqual(changed.dataHash, original.dataHash);
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', dataHash: original.dataHash, pairs: 2, holdoutPairs: 2 }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.baseline.dataHash, original.dataHash);
  assert.equal(typeof body.seatWins.baseline, 'number');
  assert.ok(body.seatWins.holdout === null || typeof body.seatWins.holdout === 'number');
  assert.equal(server.storage.get('hero_arena').dataHash, changed.dataHash);
});
test('pipeline failures retain their public code and readable message in HTTP responses', async t => {
  const { PipelineError } = await import('./playtests.js');
  const { server } = await localServer(t);
  server.handleHttp = async () => {
    throw new PipelineError({ code: 'SIMULATION_FAILED', message: 'The holdout run could not complete.' });
  };
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena' }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), {
    code: 'SIMULATION_FAILED', message: 'The holdout run could not complete.'
  });
});
test('real pipeline validation errors pass through the full route without generic transport masking', async t => {
  const { server } = await localServer(t);
  server.storage.humans = [{}];
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', pairs: 1, holdoutPairs: 1 }
  });
  assert.equal(response.status, 400);
  const body = response.json();
  assert.equal(body.code, 'INVALID_INPUT');
  assert.ok(body.message.includes('human results'));
  assert.equal(server.runningBatch, false);
});
