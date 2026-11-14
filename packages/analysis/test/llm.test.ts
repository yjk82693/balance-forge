import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiPatchAdapter, GrokPatchAdapter, buildPrompt, createAdapter, HUMAN_PREFIX,
  PATCH_JSON_SCHEMA } from '../src/index.ts';
import { fixture } from './helpers.ts';

const report = () => fixture('report_baseline.json');
const proposal = () => ({ ...fixture('patch_proposal.json'), baseDataHash: report().dataHash });
const KEY = 'SECRET-KEY-123';

const geminiBody = (p) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(p) }] } }] });
const grokBody = (p) => ({ choices: [{ message: { content: JSON.stringify(p) } }] });
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({ error: KEY }) });

function fakeFetch(...steps) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (s instanceof Error) throw s;
    if (typeof s === 'function') return s(init);
    return s;
  };
  fn.calls = calls;
  return fn;
}

test('prompt carries only aggregate rows and allowlisted paths', () => {
  const r = report();
  r.rows.push({ dimension: `${HUMAN_PREFIX}bari vs daewi`, wins: 3, games: 5, winRate: 0.6, ci95: [0.2, 0.9], uses: 0,
    opportunities: 0, outlier: false });
  const prompt = buildPrompt(r);
  assert.match(prompt, /bari vs real_armor/);
  assert.match(prompt, /\/moves\/<N>\/power/);
  assert.match(prompt, /\/tuning\/damageScalePermille/);
  assert.doesNotMatch(prompt, /human/);
  assert.doesNotMatch(prompt, /matchId|seed"|players|@/);
  assert.equal(PATCH_JSON_SCHEMA.properties.replacements.maxItems, 8);
});

test('gemini: structured JSON request, key only in header, valid proposal returned', async () => {
  const f = fakeFetch(ok(geminiBody(proposal())));
  const a = new GeminiPatchAdapter({ env: { GEMINI_API_KEY: KEY }, fetch: f });
  const out = await a.proposeWithOrigin(report());
  assert.equal(out.origin, 'gemini');
  assert.deepEqual(out.proposal, proposal());
  const { url, init } = f.calls[0];
  assert.doesNotMatch(url, new RegExp(KEY));
  assert.equal(init.headers['x-goog-api-key'], KEY);
  assert.doesNotMatch(init.body, new RegExp(KEY));
  const body = JSON.parse(init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.responseSchema);
});

test('grok: json_schema response_format, bearer header', async () => {
  const f = fakeFetch(ok(grokBody(proposal())));
  const out = await new GrokPatchAdapter({ env: { XAI_API_KEY: KEY }, fetch: f }).proposeWithOrigin(report());
  assert.equal(out.origin, 'grok');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.response_format.json_schema.schema, PATCH_JSON_SCHEMA);
  assert.equal(f.calls[0].init.headers.authorization, `Bearer ${KEY}`);
});

test('one retry: first call fails, second succeeds', async () => {
  const f = fakeFetch(fail(500), ok(geminiBody(proposal())));
  const out = await new GeminiPatchAdapter({ env: { GEMINI_API_KEY: KEY }, fetch: f }).proposeWithOrigin(report());
  assert.equal(f.calls.length, 2);
  assert.equal(out.origin, 'gemini');
});

test('timeout aborts the request (8 s default, shortened here) then falls back with origin "fallback"', async () => {
  const hang = (init) => new Promise((_, rej) => init.signal.addEventListener('abort',
    () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const f = fakeFetch(hang);
  const adapter = createAdapter('gemini', { GEMINI_API_KEY: KEY }, { fetch: f, timeoutMs: 20 });
  const out = await adapter.proposeWithOrigin(report());
  assert.equal(f.calls.length, 2); // initial + one retry, then stop
  assert.equal(out.origin, 'fallback');
  assert.match(out.fallbackReason, /timeout/);
  assert.equal(out.proposal.baseDataHash, report().dataHash);
});

test('missing key, bad JSON and invalid proposals fall back without leaking the key', async () => {
  const noKey = createAdapter('grok', {}, { fetch: fakeFetch(ok({})) });
  assert.equal((await noKey.proposeWithOrigin(report())).origin, 'fallback');

  const badJson = createAdapter('gemini', { GEMINI_API_KEY: KEY },
    { fetch: fakeFetch(ok({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })) });
  assert.equal((await badJson.proposeWithOrigin(report())).origin, 'fallback');

  const evil = { ...proposal(), replacements: [{ path: '/gameRules/x', value: 1 }] };
  const bad = createAdapter('gemini', { GEMINI_API_KEY: KEY }, { fetch: fakeFetch(ok(geminiBody(evil))) });
  assert.equal((await bad.proposeWithOrigin(report())).origin, 'fallback');

  const http = createAdapter('gemini', { GEMINI_API_KEY: KEY }, { fetch: fakeFetch(fail(401)) });
  const out = await http.proposeWithOrigin(report());
  assert.equal(out.origin, 'fallback');
  assert.doesNotMatch(JSON.stringify(out), new RegExp(KEY));
});

test('wrong base hash from the model is rejected', async () => {
  const wrong = { ...proposal(), baseDataHash: 'b'.repeat(64) };
  const a = createAdapter('gemini', { GEMINI_API_KEY: KEY }, { fetch: fakeFetch(ok(geminiBody(wrong))) });
  assert.equal((await a.proposeWithOrigin(report())).origin, 'fallback');
});

test('default adapter is the offline fake and never touches fetch', async () => {
  const f = fakeFetch(ok({}));
  const out = await createAdapter('fake', {}, { fetch: f }).proposeWithOrigin(report());
  assert.equal(out.origin, 'fake');
  assert.equal(f.calls.length, 0);
});
