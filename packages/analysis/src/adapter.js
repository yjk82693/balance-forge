// LLM adapter boundary. The model only ever returns a PatchProposal (data); nothing here executes it.
// No network access in this package: the Gemini class is a placeholder that refuses to run.

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
}

/** Placeholder for the real Gemini integration. Wire-up belongs to a later, reviewed step. */
export class GeminiPatchAdapter {
  async proposePatch() {
    throw new Error('GeminiPatchAdapter is not implemented: no network access in packages/analysis');
  }
}

/** Run an adapter and validate before anything downstream sees the result. */
export async function proposeValidated(adapter, report, validate, options = {}) {
  const proposal = await adapter.proposePatch(report);
  const check = validate(proposal, { baseDataHash: report.dataHash, ...options });
  if (!check.ok) throw new Error(`PATCH_REJECTED: ${check.errors.join('; ')}`);
  return proposal;
}
