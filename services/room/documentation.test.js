import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    if (type === 'input.submit') validate('ActionInput', envelope.payload);
    else validatePayload(type, envelope.payload);
  }
  const outgoing = ['room.status', 'match.started', 'input.ack', 'state.view', 'actions.available',
    'match.ended', 'playtest.progress', 'pong', 'error'];
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
  for (const route of ['GET /v1/games', 'POST /v1/rooms', 'GET /v1/data/:gameId',
    'POST /v1/data/:gameId/apply-patch', 'POST /v1/playtest/run', 'GET /v1/playtest/results/:id.json',
    'GET /v1/replay/:matchId', 'GET /*', 'HEAD /*', 'GET /ws']) assert.ok(readme.includes(`### ${route}`), route);
  for (const descriptor of examples.http.games.response.body) validate('GameDescriptor', descriptor);
  const base = examples.http.data.response.body;
  validate('GameData', base.data); assert.equal(hash(base.data), base.dataHash);
  assert.deepEqual(examples.http.retainedData.response.body, base);
  assert.equal(examples.http.createRoom.response.status, 201);
  assert.equal(examples.http.static.response.status, 200);
  assert.equal(examples.http.staticHead.response.body, '');
  const results = examples.http.results.response.body;
  results.forEach(result => validate('MatchResult', result));
  assert.equal(results.length, examples.http.playtest.response.body.matchCount);
  assert.equal(examples.http.applyPatch.response.body.baseDataHash, base.dataHash);
});

test('fresh production-handler captures retain the documented catalog, data and message shapes', async () => {
  const current = await collectExamples();
  assert.deepEqual(current.http.games.response.body, examples.http.games.response.body);
  assert.deepEqual(current.http.data.response.body, examples.http.data.response.body);
  assert.deepEqual(current.websocket.server['state.view'].payload, examples.websocket.server['state.view'].payload);
  assert.deepEqual(Object.keys(current.http).sort(), Object.keys(examples.http).sort());
  assert.deepEqual(Object.keys(current.websocket.server).sort(), Object.keys(examples.websocket.server).sort());
});
