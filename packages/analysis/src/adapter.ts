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

/**
 * Tentacle Run, offline: the flagged wave gets milder damage and a longer fire interval, sized by how far below its
 * target it is, so the stand-in lands near the target band instead of past it (measured on wave 4: damage x0.75 and
 * fire interval x2 take 15-20% to about 63%). A stand-in for a model, not a balance method.
 */
function wavesProposal(report, context) {
  const flagged = context.flaggedWave;
  const index = (flagged?.wave ?? 1) - 1;
  const wave = context.rootData.gameRules.waves[index];
  const gap = flagged ? flagged.target - flagged.clearRate : 0.5;
  const [damage, fire] = gap > 0.4 ? [0.75, 2] : gap > 0.2 ? [0.85, 1.5] : [0.92, 1.25];
  const replacements = [
    { path: `/gameRules/waves/${index}/enemyDamage`, value: Math.max(1, Math.round(wave.enemyDamage * damage)) },
    { path: `/gameRules/waves/${index}/fireIntervalTicks`,
      value: Math.min(300, Math.round(wave.fireIntervalTicks * fire)) }];
  return { baseDataHash: report.dataHash, replacements,
    rationale: `Offline stand-in: wave ${index + 1} is below target; damage x${damage}, fire interval x${fire}.` };
}

/** Returns a canned proposal (e.g. fixtures/patch_proposal.json). Deterministic, offline. */
export class FakePatchAdapter {
  #proposal;
  constructor(proposal) {
    this.#proposal = proposal;
  }
  async proposePatch(report, context: any = {}) {
    assertReport(report);
    if (context.rootData?.gameRules?.waves) return wavesProposal(report, context);
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
