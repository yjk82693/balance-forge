// Network LLM adapters (Gemini, Grok). They only ever return a PatchProposal as DATA.
// Keys come from environment variables only; fetch is injectable so tests never touch the network.
import { boundsFor, MAX_REPLACEMENTS, validatePatch } from './validator.js';
import { HUMAN_PREFIX } from './extras.js';

export const TIMEOUT_MS = 8000;
export const RETRIES = 1;

/** JSON Schema for PatchProposal (same constraints as spec/contract-v0.1.md). */
export const PATCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    baseDataHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    replacements: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_REPLACEMENTS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', pattern: '^/(tuning/damageScalePermille|moves/[0-9]+/power)$' },
          value: { type: 'integer', minimum: 0, maximum: 10000 },
        },
        required: ['path', 'value'],
      },
    },
    rationale: { type: 'string', maxLength: 2000 },
  },
  required: ['baseDataHash', 'replacements', 'rationale'],
};

/** Gemini's responseSchema is an OpenAPI subset: uppercase types, no additionalProperties/pattern. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    baseDataHash: { type: 'STRING' },
    replacements: {
      type: 'ARRAY',
      minItems: 1,
      maxItems: MAX_REPLACEMENTS,
      items: { type: 'OBJECT', properties: { path: { type: 'STRING' }, value: { type: 'INTEGER' } },
        required: ['path', 'value'] },
    },
    rationale: { type: 'STRING' },
  },
  required: ['baseDataHash', 'replacements', 'rationale'],
};

/**
 * The prompt contains ONLY aggregate rows (no match ids, seeds, players, hashes of matches) and the
 * allowlisted paths. Human-match rows are left out.
 */
export function buildPrompt(report) {
  const rows = report.rows
    .filter((r) => !r.dimension.startsWith(HUMAN_PREFIX))
    .map(({ dimension, wins, games, winRate, ci95, uses, opportunities, outlier }) => ({ dimension, wins, games,
      winRate, ci95, uses, opportunities, outlier }));
  const allowed = [
    { path: '/tuning/damageScalePermille', min: boundsFor('/tuning/damageScalePermille')[0],
      max: boundsFor('/tuning/damageScalePermille')[1] },
    { path: '/moves/<N>/power', min: boundsFor('/moves/0/power')[0], max: boundsFor('/moves/0/power')[1] },
  ];
  return [
    'You tune a multiplayer game. Below are aggregate bot-playtest results (win rate of the first-named side).',
    'Propose a small numeric patch that moves one-sided matchups toward 50%.',
    'Reply with JSON only: {"baseDataHash", "replacements": [{"path","value"}], "rationale"}.',
    `At most ${MAX_REPLACEMENTS} replacements, integer values only.`,
    'Use only these paths: ' + JSON.stringify(allowed),
    `baseDataHash must be exactly: ${report.dataHash}`,
    'Rows: ' + JSON.stringify(rows),
  ].join('\n');
}

async function callOnce(fetchFn, url, init, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // never echo the body or headers (keys)
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Timeout per attempt, one retry. Errors are reduced to short messages without secrets. */
export async function requestWithRetry(fetchFn, url, init, { timeoutMs = TIMEOUT_MS, retries = RETRIES, parse }) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return parse(await callOnce(fetchFn, url, init, timeoutMs));
    } catch (e) {
      last = e;
    }
  }
  const reason = last?.name === 'AbortError' ? 'timeout' : String(last?.message ?? last).slice(0, 120);
  throw new Error(`LLM request failed after ${retries + 1} attempts: ${reason}`);
}

function parseProposal(text) {
  if (typeof text !== 'string') throw new Error('empty model response');
  const proposal = JSON.parse(text);
  return proposal;
}

class LlmAdapter {
  constructor({ env = {}, fetch: fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS, retries = RETRIES, model } = {}) {
    this.env = env;
    this.fetch = fetchFn;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.model = model;
  }
  #key() {
    const key = this.env[this.keyName];
    if (!key) throw new Error(`${this.keyName} is not set`);
    return key;
  }
  async proposePatch(report) {
    const proposal = await requestWithRetry(this.fetch, this.url(), this.init(this.#key(), buildPrompt(report)), {
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      parse: (json) => {
        const p = parseProposal(this.extractText(json));
        const check = validatePatch(p, { baseDataHash: report.dataHash });
        if (!check.ok) throw new Error(`invalid proposal: ${check.errors[0]}`);
        return p;
      },
    });
    return proposal;
  }
  async proposeWithOrigin(report) {
    return { proposal: await this.proposePatch(report), origin: this.origin };
  }
}

export class GeminiPatchAdapter extends LlmAdapter {
  origin = 'gemini';
  keyName = 'GEMINI_API_KEY';
  url() {
    const model = this.model ?? this.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }
  init(key, prompt) {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_RESPONSE_SCHEMA,
          temperature: 0 },
      }),
    };
  }
  extractText(json) {
    return json?.candidates?.[0]?.content?.parts?.[0]?.text;
  }
}

export class GrokPatchAdapter extends LlmAdapter {
  origin = 'grok';
  keyName = 'XAI_API_KEY';
  url() {
    return 'https://api.x.ai/v1/chat/completions';
  }
  init(key, prompt) {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: this.model ?? this.env.XAI_MODEL ?? 'grok-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'PatchProposal', strict: true,
          schema: PATCH_JSON_SCHEMA } },
      }),
    };
  }
  extractText(json) {
    return json?.choices?.[0]?.message?.content;
  }
}

/** Primary adapter, then the fake on any failure; the result says origin "fallback" and why. */
export class FallbackAdapter {
  constructor(primary, fallback) {
    this.primary = primary;
    this.fallback = fallback;
  }
  async proposeWithOrigin(report) {
    try {
      return await this.primary.proposeWithOrigin(report);
    } catch (e) {
      const got = await this.fallback.proposeWithOrigin(report);
      return { proposal: got.proposal, origin: 'fallback', fallbackReason: String(e.message).slice(0, 160) };
    }
  }
  async proposePatch(report) {
    return (await this.proposeWithOrigin(report)).proposal;
  }
}
