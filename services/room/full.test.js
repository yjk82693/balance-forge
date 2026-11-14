import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { localServer, http } from './test-helpers.js';

const fullAvailable = existsSync(new URL('../../packages/analysis/pipeline/full.js', import.meta.url));

test('full playtest awaits the real analysis module rather than fabricating dashboard reports', async t => {
  const { server } = await localServer(t);
  if (fullAvailable) return;
  const response = await http(server, '/v1/playtest/full', { method: 'POST', body: { gameId: 'hero_arena' } });
  assert.equal(response.status, 503); assert.equal(response.json().code, 'TRANSPORT_UNAVAILABLE');
  assert.equal(server.runningBatch, false);
});

test('full playtest streams baseline and disjoint holdout phases into the shared response', {
  todo: fullAvailable ? false : 'Waiting for packages/analysis/pipeline/full.js as explicitly requested.'
}, async t => {
  if (!fullAvailable) return;
  const { server, host } = await localServer(t);
  const response = await http(server, '/v1/playtest/full', { method: 'POST', body: {
    gameId: 'hero_arena', pairs: 2, holdoutPairs: 2
  } });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.proposal.origin, 'fake'); assert.equal(body.validation.ok, true);
  assert.notEqual(body.baseline.dataHash, body.patchedDataHash);
  assert.ok(['accepted', 'rejected', 'inconclusive'].includes(body.verdict.verdict));
  const phases = new Set(host.messages.filter(e => e.type === 'playtest.progress').map(e => e.payload.phase));
  assert.deepEqual([...phases].sort(), ['baseline', 'holdout']);
});

test('run endpoint accepts roster scans and an explicit retained content pin', async t => {
  const { server } = await localServer(t), original = server.storage.get('hero_arena');
  server.storage.patch('hero_arena', { baseDataHash: original.dataHash,
    replacements: [{ path: '/moves/1/power', value: 72 }], rationale: 'test' });
  const response = await http(server, '/v1/playtest/run', { method: 'POST', body: {
    gameId: 'hero_arena', pairs: 1, roster: true, dataHash: original.dataHash
  } });
  assert.equal(response.status, 200); assert.equal(response.json().matchCount, 30);
  assert.equal(response.json().dataHash, original.dataHash);
});
