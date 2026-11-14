import { FakePatchAdapter } from './adapter.ts';
import { GeminiPatchAdapter, GrokPatchAdapter, FallbackAdapter } from './llm.ts';

export const DEFAULT_FAKE_PROPOSAL = {
  baseDataHash: '0'.repeat(64),
  replacements: [{ path: '/moves/1/power', value: 72 }],
  rationale: 'Offline placeholder proposal: lower one move power to pull the most one-sided matchup toward 50%.',
};

/** Factory for the CLI. Default is the offline fake; network adapters always fall back to it. */
export function createAdapter(name = 'fake', env = {}, options = {}) {
  const fake = new FakePatchAdapter(DEFAULT_FAKE_PROPOSAL);
  if (name === 'fake') return fake;
  if (name === 'gemini') return new FallbackAdapter(new GeminiPatchAdapter({ env, ...options }), fake);
  if (name === 'grok') return new FallbackAdapter(new GrokPatchAdapter({ env, ...options }), fake);
  throw new Error(`unknown adapter: ${name}`);
}
