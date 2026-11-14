// LLM adapter boundary. The model only ever returns a PatchProposal (data); nothing here executes it.
// Offline fake lives here; network adapters are in llm.js and are never called in tests.
import { assertReport } from './input-check.ts';

/**
 * @typedef {{ proposePatch(report: object): Promise<object> }} PatchAdapter
 */

/**
 * Hero Cards, offline: the single best measured lever of the diagnosis (the one with the largest effect toward the
 * target). Without a diagnosis there is nothing to follow, so the proposal raises the cost of the first card by one:
 * a placeholder the validator accepts, never a balance method.
 */
function cardsProposal(report, context) {
  const lever = context.diagnosis?.kind === 'cards' ? context.diagnosis.levers[0] : null;
  const cards = context.rootData.gameRules.cards;
  const change = lever ? { path: lever.path, value: lever.to, why: `${lever.cardId} ${lever.field} ${lever.from} -> `
    + `${lever.to}: measured effect ${Math.round(lever.effect * 1000) / 10} points` }
    : { path: '/gameRules/cards/0/cost', value: Math.min(3, cards[0].cost + 1), why: 'placeholder' };
  return { baseDataHash: report.dataHash, replacements: [{ path: change.path, value: change.value }],
    rationale: `Offline stand-in: ${change.why}.` };
}

/** Returns a canned proposal (e.g. fixtures/patch_proposal.json). Deterministic, offline. */
export class FakePatchAdapter {
  #proposal;
  constructor(proposal) {
    this.#proposal = proposal;
  }
  async proposePatch(report, context: any = {}) {
    assertReport(report);
    if (context.rootData?.gameRules?.cards) return cardsProposal(report, context);
    // Keep the pin honest: the proposal must be based on the report's data.
    return { ...structuredClone(this.#proposal), baseDataHash: report.dataHash };
  }
  async proposeWithOrigin(report, context: any = {}) {
    return { proposal: await this.proposePatch(report, context), origin: 'fake' };
  }
}

/** Run an adapter and validate before anything downstream sees the result. */
export async function proposeValidated(adapter, report, validate, options: any = {}) {
  const proposal = await adapter.proposePatch(report);
  const check = validate(proposal, { baseDataHash: report.dataHash, ...options });
  if (!check.ok) throw new Error(`PATCH_REJECTED: ${check.errors.join('; ')}`);
  return proposal;
}
