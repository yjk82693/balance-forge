// Proposers for the search that are not the Gaussian CEM, behind the same interface (see cem.js):
//   mutationProposer - blind mutation of the best vector so far. It is the ablation baseline and the offline stand-in
//                      for the coach (origin "fake"): deterministic, no network.
//   coachProposer    - a language-model coach (Gemini): it is shown the aggregate results of the last generations and
//                      proposes the next vectors under the same candidate budget. Origin "gemini"; without a key, or
//                      when a request fails, the stand-in answers and the origin says "fake" or "fallback".
// The key comes from the environment only. The prompt holds parameter ranges and scores, nothing else; a reply is data
// (numbers) that the search sanitises like any other proposal. Tests inject `fetch`: nothing here calls the network.
import { PARAM_NAMES, PARAM_SPECS } from '../../../packages/games/action/bot-learned.ts';
import { fromUnit, toUnit } from './cem.ts';
import { makeRng, subSeed } from './rng.ts';

export const COACH_TIMEOUT_MS = 8000;
export const COACH_RETRIES = 1;

/** Blind mutation: the best vector so far plus seeded Gaussian noise in unit space. */
export function mutationProposer({ seed, start, sigma = 0.12 }) {
  const rng = makeRng(subSeed(seed, 2));
  let best = { params: { ...start }, fitness: -Infinity };
  return {
    origin: 'fake',
    propose({ generation, count }) {
      return Array.from({ length: count }, (_, i) => (generation === 0 && i === 0 ? { ...start } :
        Object.fromEntries(PARAM_NAMES.map(name => [name, fromUnit(name,
          toUnit(name, best.params[name]) + sigma * rng.normal())]))));
    },
    update({ scored }: { generation?: number; scored: any[] }) {
      for (const entry of scored) if (entry.fitness > best.fitness) best = entry;
    }
  };
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    candidates: { type: 'ARRAY', items: { type: 'OBJECT', properties: Object.fromEntries(PARAM_NAMES.map(name =>
      [name, { type: 'INTEGER' }])), required: PARAM_NAMES } },
    rationale: { type: 'STRING' }
  },
  required: ['candidates']
};

/** The text sent to the model: ranges and the last generations' aggregate scores only. */
export function coachPrompt({ hero, count, history }) {
  const recent = history.slice(-2).map(g => ({ generation: g.generation,
    top: [...g.scored].sort((a, b) => b.fitness - a.fitness).slice(0, 4).map(e => ({ params: e.params,
      fitness: Math.round(e.fitness * 1000) / 1000 })),
    worst: [...g.scored].sort((a, b) => a.fitness - b.fitness).slice(0, 2).map(e => ({ params: e.params,
      fitness: Math.round(e.fitness * 1000) / 1000 })) }));
  return [
    `You tune the behaviour parameters of a game bot for the hero "${hero}". A candidate's fitness is its win rate `
      + '(draws count half) in simulated matches against the other heroes; higher is better.',
    `Propose ${count} new candidate vectors. Every value is an integer inside its range.`,
    'Ranges: ' + JSON.stringify(Object.fromEntries(PARAM_NAMES.map(name => [name, [PARAM_SPECS[name].min,
      PARAM_SPECS[name].max]]))),
    recent.length ? 'Results of the last generations (best and worst candidates): ' + JSON.stringify(recent)
      : 'This is the first generation: spread the candidates over reasonable values.',
    'Reply with JSON only: {"candidates": [{...all parameters...}], "rationale": "one sentence"}.'
  ].join('\n');
}

async function request(fetchFn, url, init, timeoutMs) {
  const controller = new AbortController();
  let timer;
  // Raced against a timer as well as aborted: a fetch that ignores its signal still cannot hang the run.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Error('timeout'));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([fetchFn(url, { ...init, signal: controller.signal }), timeout]);
    if (!response.ok) throw Error(`HTTP ${response.status}`); // never echo a body or a header (the key)
    return await Promise.race([response.json(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Candidate objects from a Gemini reply, or throws. Values are not trusted: the search sanitises them. */
export function parseCandidates(json) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw Error('no text in the reply');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.candidates)) throw Error('no candidates in the reply');
  return parsed.candidates;
}

export function coachProposer({ seed, start, hero = 'hero', env = {} as Record<string, string>,
  fetch: fetchFn = globalThis.fetch, timeoutMs = COACH_TIMEOUT_MS, retries = COACH_RETRIES, model }: any) {
  const standIn = mutationProposer({ seed, start });
  const history = [];
  const origins = [];
  const key = env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model ??
    env.GEMINI_MODEL ?? 'gemini-flash-lite-latest')}:generateContent`;
  return {
    get origin() {
      const kinds = new Set(origins);
      return kinds.size === 0 ? (key ? 'gemini' : 'fake') : kinds.size === 1 ? [...kinds][0] : 'mixed';
    },
    origins,
    async propose({ generation, count }) {
      if (!key || typeof fetchFn !== 'function') {
        origins.push('fake');
        return standIn.propose({ generation, count });
      }
      const init = { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: coachPrompt({ hero, count, history }) }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA,
            temperature: 0.4 } }) };
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const candidates = parseCandidates(await request(fetchFn, url, init, timeoutMs)).slice(0, count);
          if (candidates.length === 0) throw Error('empty candidate list');
          origins.push('gemini');
          // A short list is topped up by mutation so the budget stays the same; generation 0 keeps the start vector.
          const missing = count - candidates.length;
          const filler = standIn.propose({ generation: generation === 0 ? 1 : generation, count: missing });
          return [...(generation === 0 ? [{ ...start }] : []), ...candidates, ...filler].slice(0, count);
        } catch {
          // try again, then fall back below
        }
      }
      origins.push('fallback');
      return standIn.propose({ generation, count });
    },
    update({ generation, scored }) {
      history.push({ generation, scored });
      standIn.update({ scored });
    }
  };
}
