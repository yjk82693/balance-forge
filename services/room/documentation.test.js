import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { payloadSchemas, parseEnvelope, validatePayload } from './protocol.js';
import { validate, validateGamePayload, hash } from '../../packages/contracts/index.js';
import { collectExamples } from './generate-examples.js';
const examples = JSON.parse(readFileSync(new URL('./examples.json', import.meta.url)));
const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
test('reference lists every implemented client and server message with schema-valid captured examples', () => {
  const incoming = [...Object.keys(payloadSchemas), 'input.submit'].sort();
  assert.deepEqual(Object.keys(examples.websocket.client).sort(), incoming);
  for (const type of incoming) {
    assert.ok(readme.includes(`### ${type} — client to server`), type);
    const envelope = parseEnvelope(JSON.stringify(examples.websocket.client[type]));
    if (type === 'input.submit') validate('ActionInput', envelope.payload);else validatePayload(type, envelope.payload);
  }
  const outgoing = ['room.status', 'match.started', 'input.ack', 'state.view', 'actions.available', 'match.ended',
    'playtest.progress', 'pong', 'error'];
  assert.deepEqual(Object.keys(examples.websocket.server).sort(), outgoing.sort());
  for (const type of outgoing) {
    assert.ok(readme.includes(`### ${type} — server to client`), type);
    parseEnvelope(JSON.stringify(examples.websocket.server[type]));
  }
  const view = examples.websocket.server['state.view'].payload;
  validate('Observation', view.observation);
  validateGamePayload('hero_arena', 1, 'observation', view.observation.payload);
  assert.equal(view.viewHash, hash(view.observation));
  validate('MatchConfig', examples.websocket.server['match.started'].payload.config);
  validate('MatchResult', examples.websocket.server['match.ended'].payload.result);
});
test('reference covers every HTTP route, retained versions and static HEAD with captured response bodies', () => {
  for (const route of ['GET /v1/games', 'POST /v1/rooms', 'GET /v1/data/:gameId', 'POST /v1/data/:gameId/apply-patch',
    'POST /v1/playtest/run', 'POST /v1/playtest/full', 'GET /v1/replay/:matchId/views',
    'GET /v1/playtest/results/:id.json', 'GET /v1/replay/:matchId', 'GET /*', 'HEAD /*', 'GET /ws',
    'GET /v1/versions/:gameId', 'GET /v1/versions/:gameId/:hash', 'POST /v1/versions/:gameId/:hash/approve',
    'POST /v1/data/:gameId/select', 'POST /v1/playtest/auto']) assert.ok(readme.includes(`### ${route}`), route);
  for (const descriptor of examples.http.games.response.body) validate('GameDescriptor', descriptor);
  const base = examples.http.data.response.body;
  validate('GameData', base.data);
  assert.equal(hash(base.data), base.dataHash);
  assert.deepEqual(examples.http.retainedData.response.body, base);
  assert.equal(examples.http.createRoom.response.status, 201);
  assert.equal(examples.http.static.response.status, 200);
  assert.equal(examples.http.staticHead.response.body, '');
  assert.equal(examples.http.full.response.status, existsSync(new URL('../../packages/analysis/pipeline/full.js',
    import.meta.url)) ? 200 : 503);
  assert.equal(examples.http.full.response.body.fair, true); // 2 games: no outlier, baseline only
  assert.equal(examples.http.full.response.body.proposal, null);
  const pair = examples.http.fullPair.response.body;
  assert.equal(pair.fair, false);
  assert.equal(pair.proposal.origin, 'fake');
  assert.equal(pair.diagnosis.matchup, 'bari vs daewi');
  assert.ok(pair.diagnosis.recommendations.length > 0);
  assert.deepEqual(pair.baseline.rows.map(row => row.dimension).filter(name => !name.startsWith('human: ')),
    ['bari vs daewi']);
  assert.equal(examples.http.mirrorInvalid.response.status, 400);
  assert.equal(examples.http.mirrorInvalid.response.body.code, 'MIRROR_MATCHUP');
  assert.equal(examples.http.views.response.status, 200);
  const results = examples.http.results.response.body;
  results.forEach(result => validate('MatchResult', result));
  assert.equal(results.length, examples.http.playtest.response.body.matchCount);
  assert.equal(examples.http.applyPatch.response.body.baseDataHash, base.dataHash);
  const list = examples.http.versions.response.body, patched = examples.http.applyPatch.response.body.dataHash;
  const versions = list.versions;
  assert.ok(Array.isArray(versions));
  assert.equal(list.currentHash, patched); // apply-patch selects the new version
  assert.equal(versions[0].parentHash, null);
  assert.equal(versions[0].dataHash, base.dataHash);
  assert.ok(versions.some(record => record.dataHash === patched && record.parentHash === base.dataHash));
  assert.equal(examples.http.version.response.body.dataHash, patched);
  assert.ok(Array.isArray(examples.http.version.response.body.diff));
  assert.equal(examples.http.approve.response.body.approved, true);
  assert.equal(examples.http.autoInvalid.response.status, 400);
  const selected = examples.http.select.response.body;
  assert.equal(selected.currentHash, base.dataHash); // the same list shape as GET /v1/versions/:gameId
  assert.deepEqual(selected.versions.map(record => record.dataHash), versions.map(record => record.dataHash));
});
test('fresh production-handler captures retain the documented catalog, data and message shapes', async () => {
  const current = await collectExamples();
  assert.deepEqual(current.http.games.response.body, examples.http.games.response.body);
  assert.deepEqual(current.http.data.response.body, examples.http.data.response.body);
  assert.deepEqual(current.websocket.server['state.view'].payload, examples.websocket.server['state.view'].payload);
  assert.deepEqual(Object.keys(current.http).sort(), Object.keys(examples.http).sort());
  assert.deepEqual(Object.keys(current.websocket.server).sort(), Object.keys(examples.websocket.server).sort());
});
