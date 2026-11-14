// Network LLM adapters (Gemini, Grok). They only ever return a PatchProposal as DATA.
// Keys come from environment variables only; fetch is injectable so tests never touch the network.
import { boundsFor, MAX_REPLACEMENTS, validatePatch } from './validator.ts';
import { HUMAN_PREFIX } from './extras.ts';
import { assertReport } from './input-check.ts';

export const TIMEOUT_MS = 8000;
// gemini-2.5-flash is no longer available to new keys; the flash-lite alias answered in about a second. Override with
// the GEMINI_MODEL environment variable.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';
export const RETRIES = 1;

export const PATH_PATTERN = '^/(tuning/damageScalePermille|moves/(0|[1-9][0-9]*)/power|'
  + 'characters/(0|[1-9][0-9]*)/(health|speed)|gameRules/cards/(0|[1-9][0-9]*)/(cost|power))$';

/** JSON Schema for PatchProposal (spec/contract-v0.1.md plus the v0.1.2 hero stat paths). */
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
          path: { type: 'string', pattern: PATH_PATTERN },
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
/** The diagnosis as aggregate numbers only: rates, games, roles, the ranked recommendations. */
function compactDiagnosis(d) {
  return {
    matchup: d.matchup,
    classification: d.classification,
    heroes: d.heroes.map((h) => ({ hero: h.hero, strength: h.strength,
      overall: { rate: h.overall.rate, games: h.overall.games },
      opponents: h.opponents.map((o) => ({ opponent: o.opponent, rate: o.rate, games: o.games })) })),
    recommendations: d.recommendations.map(({ hero, role, path, direction, sizePct, why, expected, alsoAffects }) => ({
      hero, role, path, direction, sizePct, why, expected, alsoAffects })),
  };
}

/** Original health and speed per hero with the range the patch may use (within 40% and the absolute bounds). */
function heroStats(rootData) {
  const range = (value, [low, high]) => [Math.max(low, Math.ceil((value * 6) / 10)),
    Math.min(high, Math.floor((value * 14) / 10))];
  return rootData.characters.map((c, index) => ({ index, id: c.id,
    health: { original: c.health, allowed: range(c.health, boundsFor('/characters/0/health')) },
    speed: { original: c.speed, allowed: range(c.speed, boundsFor('/characters/0/speed')) } }));
}

/** Hero Cards: the card table (index, kind, cost, power) and the measured levers, aggregate numbers only. */
function cardContext(rootData, diagnosis) {
  const cards = rootData.gameRules.cards.map((c, index) => ({ index, id: c.id, kind: c.kind, cost: c.cost,
    power: c.power, ...(c.kind === 'peek' ? { power_fixed: true } : {}) }));
  const lines = ['Hero Cards: the matchup is deck against deck. Cards (index = the N in the paths): '
    + JSON.stringify(cards) + '. Cost 1..3, power 1..10; a peek card has no power to change.'];
  if (diagnosis?.kind === 'cards') {
    lines.push('Measured levers: each was run on fresh seeds against the unchanged data. effect is the change in the '
      + `win rate of ${diagnosis.focalDeck} (points of 1.0), "up"/"down" says which way the rate must move. Choose `
      + 'from these levers (at most 3 changes), do not guess: ' + JSON.stringify({ matchup: diagnosis.matchup,
        focalRate: diagnosis.focalRate, target: diagnosis.target, direction: diagnosis.direction,
        levers: diagnosis.levers.map(({ path, cardId, field, from, to, effect, significant }) => ({ path, cardId, field,
          from, to, effect, significant })) }));
  }
  return lines;
}

export function buildPrompt(report, context: any = {}) {
  assertReport(report);
  const rows = report.rows
    .filter((r) => !r.dimension.startsWith(HUMAN_PREFIX))
    .map(({ dimension, wins, games, winRate, ci95, uses, opportunities, outlier, target, deltaToTarget }) => ({
      dimension, wins, games, winRate, ci95, uses, opportunities, outlier, target, deltaToTarget }));
  const hasTargets = rows.some((r) => r.target !== undefined && r.target !== 0.5);
  const allowed = [
    { path: '/tuning/damageScalePermille', min: boundsFor('/tuning/damageScalePermille')[0],
      max: boundsFor('/tuning/damageScalePermille')[1] },
    { path: '/moves/<N>/power', min: boundsFor('/moves/0/power')[0], max: boundsFor('/moves/0/power')[1] },
    { path: '/characters/<N>/health', min: boundsFor('/characters/0/health')[0],
      max: boundsFor('/characters/0/health')[1], hero_only: true },
    { path: '/characters/<N>/speed', min: boundsFor('/characters/0/speed')[0],
      max: boundsFor('/characters/0/speed')[1], hero_only: true },
    { path: '/gameRules/cards/<N>/cost', min: boundsFor('/gameRules/cards/0/cost')[0],
      max: boundsFor('/gameRules/cards/0/cost')[1], cards_only: true },
    { path: '/gameRules/cards/<N>/power', min: boundsFor('/gameRules/cards/0/power')[0],
      max: boundsFor('/gameRules/cards/0/power')[1], cards_only: true },
  ];
  const isCards = Boolean(context.rootData?.gameRules?.cards);
  return [
    'You tune a multiplayer game. Below are aggregate bot-playtest results (win rate of the first-named side).',
    hasTargets ? 'Each row has a target (the designer\'s intended win rate of the first-named side) and deltaToTarget. '
      + 'Propose a small numeric patch that moves matchups toward their own targets, not toward 50%.'
      : 'Propose a small numeric patch that moves one-sided matchups toward 50%.',
    'Reply with JSON only: {"baseDataHash", "replacements": [{"path","value"}], "rationale"}.',
    `At most ${MAX_REPLACEMENTS} replacements, integer values only.`,
    'Use only these paths: ' + JSON.stringify(allowed.filter((a) => Boolean(a.cards_only) === isCards)),
    ...(isCards ? cardContext(context.rootData, context.diagnosis) : []),
    ...(context.rootData?.characters?.length ? [
      'Hero stats may move at most 40% from the original value (health and speed belong to one hero only). Heroes: '
      + JSON.stringify(heroStats(context.rootData))] : []),
    `baseDataHash must be exactly: ${report.dataHash}`,
    'Rows: ' + JSON.stringify(rows),
    ...(context.diagnosis && context.diagnosis.kind !== 'cards' ? [
      'Diagnosis of the flagged matchup (both heroes against the other heroes; win rate of each hero, direction "up"'
      + ' raises the number, "down" lowers it, sizePct is a suggested relative change). Prefer the first'
      + ' recommendation unless the rows contradict it:',
      JSON.stringify(compactDiagnosis(context.diagnosis)),
    ] : []),
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
  declare env: Record<string, string>;
  declare fetch: typeof fetch;
  declare timeoutMs: number;
  declare retries: number;
  declare model: string | undefined;
  [member: string]: any; // keyName, origin, url, init and extractText come from the subclasses
  constructor({ env = {}, fetch: fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS, retries = RETRIES,
    model }: any = {}) {
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
  async proposePatch(report, context: any = {}) {
    const prompt = buildPrompt(report, context);
    const proposal = await requestWithRetry(this.fetch, this.url(), this.init(this.#key(), prompt), {
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      parse: (json) => {
        const p = parseProposal(this.extractText(json));
        const check = validatePatch(p, { baseDataHash: report.dataHash, rootData: context.rootData });
        if (!check.ok) throw new Error(`invalid proposal: ${check.errors[0]}`);
        return p;
      },
    });
    return proposal;
  }
  async proposeWithOrigin(report, context: any = {}) {
    return { proposal: await this.proposePatch(report, context), origin: this.origin };
  }
}

export class GeminiPatchAdapter extends LlmAdapter {
  origin = 'gemini';
  keyName = 'GEMINI_API_KEY';
  url() {
    const model = this.model ?? this.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
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
  declare primary: any;
  declare fallback: any;
  constructor(primary, fallback) {
    this.primary = primary;
    this.fallback = fallback;
  }
  async proposeWithOrigin(report, context: any = {}) {
    try {
      return await this.primary.proposeWithOrigin(report, context);
    } catch (e) {
      const got = await this.fallback.proposeWithOrigin(report, context);
      return { proposal: got.proposal, origin: 'fallback', fallbackReason: String(e.message).slice(0, 160) };
    }
  }
  async proposePatch(report, context: any = {}) {
    return (await this.proposeWithOrigin(report, context)).proposal;
  }
}
