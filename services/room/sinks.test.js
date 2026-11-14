import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http } from './test-helpers.js';

function fakeSinks({ trend = null, enabled = [] } = {}) {
  const calls = [];
  return { calls, enabled, status: Object.fromEntries(enabled.map(name => [name,
    { written: 3, failed: 1, lastError: 'mongodb://secret-host' }])),
  emit: (kind, payload) => calls.push({ kind, payload }),
  trend: async () => trend, flush: async () => {}, close: async () => { calls.push({ kind: 'closed' }); } };
}

test('sinks are off by default and /v1/sinks and /v1/trend say so', async t => {
  const { server } = await localServer(t);
  assert.deepEqual((await http(server, '/v1/sinks')).json(), { enabled: [], status: {} });
  const trend = await http(server, '/v1/trend/hero_arena?matchup=bari%20vs%20daewi');
  assert.equal(trend.status, 404);
});

test('/v1/sinks shows names and counts only; /v1/trend validates the matchup and returns the points', async t => {
  const sinks = fakeSinks({ enabled: ['mongodb', 'tiger'], trend: [{ data_hash: 'x', games: 10, rate: 0.5 }] });
  const { server } = await localServer(t, { sinks });
  const body = (await http(server, '/v1/sinks')).json();
  assert.deepEqual(body, { enabled: ['mongodb', 'tiger'], status: { mongodb: { written: 3, failed: 1 },
    tiger: { written: 3, failed: 1 } } });
  assert.ok(!JSON.stringify(body).includes('secret-host'));
  const trend = await http(server, '/v1/trend/hero_arena?matchup=bari%20vs%20daewi');
  assert.equal(trend.status, 200);
  assert.equal(trend.json().points.length, 1);
  assert.equal((await http(server, '/v1/trend/hero_arena?matchup=drop%20table')).status, 400);
});

test('runs emit matches and a report, versions and human results are emitted, close closes the sinks', async t => {
  const sinks = fakeSinks();
  const { server } = await localServer(t, { sinks });
  const run = await http(server, '/v1/playtest/full', { method: 'POST', body: { gameId: 'hero_arena',
    heroes: ['bari', 'daewi'], pairs: 3, holdoutPairs: 3 } });
  assert.equal(run.status, 200);
  const kinds = sinks.calls.map(call => call.kind);
  assert.ok(kinds.includes('matches') && kinds.includes('report'));
  const matches = sinks.calls.filter(call => call.kind === 'matches');
  assert.equal(matches[0].payload.phase, 'baseline');
  assert.equal(matches[0].payload.results.length, 6);
  assert.equal(matches[0].payload.runId, run.json().runId);
  assert.match(matches[0].payload.botPolicyVersion, /^scripted/);
  assert.equal(sinks.calls.find(call => call.kind === 'report').payload.runId, run.json().runId);
  const hash = server.storage.get('hero_arena').dataHash;
  const before = sinks.calls.filter(call => call.kind === 'version').length;
  server.storage.recordVersion(server.storage.versionStore.list('hero_arena')[0]); // a repeat is not re-emitted
  assert.equal(sinks.calls.filter(call => call.kind === 'version').length, before);
  assert.ok(hash);
  await server.close();
  assert.ok(sinks.calls.some(call => call.kind === 'closed'));
});

test('a sink that throws on close cannot stop the server from closing', async t => {
  const sinks = fakeSinks();
  sinks.close = async () => { throw Error('boom'); };
  const { server } = await localServer(t, { sinks });
  await server.close();
});
