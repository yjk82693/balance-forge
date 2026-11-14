import { FakePatchAdapter } from './adapter.js';

export const DEFAULT_FAKE_PROPOSAL = {
  baseDataHash: '0'.repeat(64),
  replacements: [{ path: '/moves/1/power', value: 72 }],
  rationale: 'Offline placeholder proposal: lower one move power to pull the most one-sided matchup toward 50%.',
};

/** Factory for the CLI. Default is the offline fake. */
export function createAdapter(name, env = {}) {
  if (name === 'fake') return new FakePatchAdapter(DEFAULT_FAKE_PROPOSAL);
  throw new Error(`unknown adapter: ${name}`);
}
