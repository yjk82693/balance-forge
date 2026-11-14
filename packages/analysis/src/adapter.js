// LLM adapter boundary. The model only ever returns a PatchProposal (data); nothing here executes it.
// Offline fake lives here; network adapters are in llm.js and are never called in tests.

/**
 * @typedef {{ proposePatch(report: object): Promise<object> }} PatchAdapter
 */

/** Returns a canned proposal (e.g. fixtures/patch_proposal.json). Deterministic, offline. */
export class FakePatchAdapter {
  #proposal;
  constructor(proposal) {
    this.#proposal = proposal;
  }
  async proposePatch(report) {
    // Keep the pin honest: the proposal must be based on the report's data.
    return { ...structuredClone(this.#proposal), baseDataHash: report.dataHash };
  }
  async proposeWithOrigin(report) {
    return { proposal: await this.proposePatch(report), origin: 'fake' };
  }
}

/** Run an adapter and validate before anything downstream sees the result. */
export async function proposeValidated(adapter, report, validate, options = {}) {
  const proposal = await adapter.proposePatch(report);
  const check = validate(proposal, { baseDataHash: report.dataHash, ...options });
  if (!check.ok) throw new Error(`PATCH_REJECTED: ${check.errors.join('; ')}`);
  return proposal;
}
