import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, PARAM_NAMES, PARAM_SPECS, validateParams } from
  '../../../packages/games/action/bot-learned.ts';
import { cemProposer, runSearch, toUnit } from './cem.ts';
import { coachProposer, coachPrompt, mutationProposer, parseCandidates } from './coach.ts';

const TARGET = { standOff: 1500, reaction: 2, guardChance: 95, meleeClose: 1200, aggression: 100, aimBias: 120,
  strafePeriod: 20 };
const closeness = params => 1 - Math.sqrt(PARAM_NAMES.reduce((s, n) =>
  s + (toUnit(n, params[n]) - toUnit(n, TARGET[n])) ** 2, 0));
const evaluate = async list => list.map(closeness);
const reply = candidates => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{
  text: JSON.stringify({ candidates, rationale: 'x' }) }] } }] }) });

test('the mutation stand-in is seeded, deterministic, labelled fake, keeps the start in generation 0', async () => {
  const run = seed => runSearch({ proposer: mutationProposer({ seed, start: DEFAULT_PARAMS }), evaluate, generations: 6,
    population: 8, start: DEFAULT_PARAMS });
  const first = await run(4);
  assert.deepEqual(await run(4), first);
  assert.ok(first.bestFitness >= closeness(DEFAULT_PARAMS));
  assert.equal(mutationProposer({ seed: 1, start: DEFAULT_PARAMS }).origin, 'fake');
  assert.deepEqual(mutationProposer({ seed: 1, start: DEFAULT_PARAMS }).propose({ generation: 0, count: 3 })[0],
    DEFAULT_PARAMS);
});

test('without a key the coach is the offline stand-in and says so; nothing calls the network', async () => {
  let calls = 0;
  const coach = coachProposer({ seed: 2, start: DEFAULT_PARAMS, env: {}, fetch: async () => { calls += 1; } });
  const out = await runSearch({ proposer: coach, evaluate, generations: 3, population: 6, start: DEFAULT_PARAMS });
  assert.equal(calls, 0);
  assert.equal(coach.origin, 'fake');
  assert.deepEqual(coach.origins, ['fake', 'fake', 'fake']);
  assert.equal(out.evaluated, 18);
  const noFetch = coachProposer({ seed: 2, start: DEFAULT_PARAMS, env: { GEMINI_API_KEY: 'k' }, fetch: null });
  assert.equal(noFetch.propose({ generation: 0, count: 2 }) instanceof Promise, true);
});

test('with a key and a working reply the candidates come from the model, under the same budget', async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    return reply([{ ...DEFAULT_PARAMS, standOff: 1800 }, { ...TARGET }, { ...DEFAULT_PARAMS, reaction: 3 }]);
  };
  const coach = coachProposer({ seed: 3, start: DEFAULT_PARAMS, hero: 'daewi',
    env: { GEMINI_API_KEY: 'secret-key' }, fetch });
  const out = await runSearch({ proposer: coach, evaluate, generations: 2, population: 4, start: DEFAULT_PARAMS });
  assert.equal(out.evaluated, 8); // the same candidate budget as any other proposer
  assert.equal(coach.origin, 'gemini');
  assert.deepEqual(coach.origins, ['gemini', 'gemini']);
  assert.equal(sent.length, 2);
  assert.match(sent[0].url,
    /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-flash-lite-latest:generate/);
  assert.equal(sent[0].init.headers['x-goog-api-key'], 'secret-key'); // header only, never in the URL or the body
  assert.doesNotMatch(sent[0].url + sent[0].init.body, /secret-key/);
  assert.ok(out.bestFitness >= closeness(TARGET) - 1e-9, 'the model proposed the target vector');
  // the second request carries the first generation's results, the first does not
  assert.match(sent[1].init.body, /Results of the last generations/);
  assert.doesNotMatch(sent[0].init.body, /Results of the last generations/);
});

test('a failing model falls back to the stand-in, labelled, and the run still finishes', async () => {
  for (const fetch of [async () => ({ ok: false, status: 500 }), async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => ({}) }), async () => reply('nope'), async () => reply([]),
    () => new Promise(() => {})]) {
    const coach = coachProposer({ seed: 5, start: DEFAULT_PARAMS, env: { GEMINI_API_KEY: 'k' }, fetch, timeoutMs: 20,
      retries: 0 });
    const out = await runSearch({ proposer: coach, evaluate, generations: 2, population: 4, start: DEFAULT_PARAMS });
    assert.equal(coach.origin, 'fallback');
    assert.equal(out.evaluated, 8);
    assert.doesNotThrow(() => validateParams(out.best));
  }
});

test('a model that proposes garbage cannot crash a run: bad fields fall back, a short list is topped up', async () => {
  const garbage = [{ standOff: 'far', reaction: 99 }, null, 7, { ...DEFAULT_PARAMS, aggression: 1.5 }];
  const coach = coachProposer({ seed: 6, start: DEFAULT_PARAMS, env: { GEMINI_API_KEY: 'k' },
    fetch: async () => reply(garbage) });
  const out = await runSearch({ proposer: coach, evaluate, generations: 1, population: 6, start: DEFAULT_PARAMS });
  assert.equal(out.evaluated, 6);
  assert.ok(out.curve[0].fellBack >= 3);
  assert.doesNotThrow(() => validateParams(out.best));
  for (const value of Object.values(out.best)) assert.ok(Number.isInteger(value));
});

test('the prompt holds ranges and aggregate scores only', () => {
  const history = [{ generation: 0,
    scored: [{ params: DEFAULT_PARAMS, fitness: 0.4 }, { params: TARGET, fitness: 0.9 }] }];
  const text = coachPrompt({ hero: 'bari', count: 4, history });
  for (const name of PARAM_NAMES) {
    assert.ok(text.includes(`"${name}":[${PARAM_SPECS[name].min},${PARAM_SPECS[name].max}]`));
  }
  assert.match(text, /Propose 4 new candidate vectors/);
  assert.match(text, /"fitness":0\.9/);
  assert.doesNotMatch(text, /seed|matchId|finalStateHash/);
  assert.match(coachPrompt({ hero: 'bari', count: 4, history: [] }), /first generation/);
  const wrapped = { candidates: [{ content: { parts: [{ text: JSON.stringify({ candidates: [{ a: 1 }] }) }] } }] };
  assert.deepEqual(parseCandidates(wrapped), [{ a: 1 }]);
  assert.throws(() => parseCandidates({}), /no text/);
});

test('CEM and the coach share one interface: the same search code runs both', async () => {
  for (const proposer of [cemProposer({ seed: 1, start: DEFAULT_PARAMS }), mutationProposer({ seed: 1,
    start: DEFAULT_PARAMS }), coachProposer({ seed: 1, start: DEFAULT_PARAMS })]) {
    const out = await runSearch({ proposer, evaluate, generations: 2, population: 4, start: DEFAULT_PARAMS });
    assert.equal(out.curve.length, 2);
    assert.equal(typeof proposer.origin, 'string');
  }
});
