// Re-runs the analysis of a finished full run on its stored results, with another design intent (or the same one):
// report rows with target and deltaToTarget, outliers, the per-target verdict and the diagnosis margins. No
// simulation: the stored baseline, holdout and diagnosis results are replayed through the same code a fresh run
// uses, so the answer is identical to a fresh run on those results under that intent, in a fraction of a second.
//
// input: { stored (the body of the original run), baselineResults, holdoutResults | null, diagnoseResults | null,
//   humanResults, baseData, rootData, hashData, intent }. Resolves { ok: true, value } or an error result.
// value is the same body as runFull, plus `reanalyzed: true`. Two honest limits are flagged in it:
//   stale: true            the run stopped at its baseline (it was fair under the old intent) and the matchup is
//                          flagged under the new one: no proposal or holdout to judge, run the playtest again;
//   diagnosisIncomplete    the stored diagnosis results do not cover every matchup the new focus needs.
import { fail, safely } from '../src/errors.js';
import { HUMAN_PREFIX } from '../src/extras.js';
import { heroMatchup } from '../src/group.js';
import { isMirror } from '../src/verdict.js';
import { analyzePhase } from './pipeline.js';
import { runFull } from './full.js';

const seedsOf = (results) => [...new Set(results.map((r) => r.config.seed))].sort((a, b) => a - b);

/** An adapter that hands back the proposal of the original run, with its origin; it never asks a model. */
const replayAdapter = (stored) => ({
  async proposeWithOrigin(report) {
    const { baseDataHash, replacements, rationale, origin } = stored.proposal;
    return { origin, proposal: { baseDataHash: report.dataHash ?? baseDataHash, replacements, rationale } };
  },
});

async function reanalyzeUnsafe(input) {
  const { stored, baselineResults, holdoutResults = null, diagnoseResults = null, humanResults = [], baseData,
    rootData, hashData, intent } = input ?? {};
  if (!stored || typeof stored !== 'object') fail('INVALID_INPUT', 'stored must be the body of the original run');
  if (!Array.isArray(baselineResults) || baselineResults.length === 0) fail('NO_RESULTS', 'no stored baseline results');
  const baseline = stored.baseline ?? {};
  const botPolicyVersion = stored.botPolicyVersion ?? baseline.botPolicyVersion;
  const seedSetId = stored.seedSetId ?? baseline.seedSetId;

  const first = analyzePhase(baselineResults, { reportId: 'r-baseline', intent, botPolicyVersion, seedSetId }).report;
  const flagged = first.rows.some((r) => r.outlier && !r.dimension.startsWith(HUMAN_PREFIX) && !isMirror(r));
  const canJudge = Boolean(holdoutResults?.length && stored.proposal);
  if (flagged && !canJudge) {
    return { baseline: first, fair: false, stale: true, proposal: null, validation: null, patched: null,
      patchedDataHash: null, reanalyzed: true, intentVersion: first.intentVersion,
      verdict: { verdict: 'inconclusive', targets: [], reasons: [
        'the original run stopped at its baseline; under this intent the matchup is flagged: run it again'] } };
  }

  const holdoutSeeds = canJudge ? seedsOf(holdoutResults) : [1_000_000_001];
  const requested = [];
  const full = await runFull({
    baselineResults, humanResults, baseData, rootData, hashData, intent, holdoutSeeds,
    adapter: canJudge ? replayAdapter(stored) : undefined,
    runHoldout: async () => holdoutResults,
    ...(diagnoseResults?.length ? {
      diagnoseSeeds: seedsOf(diagnoseResults),
      runDiagnose: async (matchups) => {
        requested.push(...matchups);
        const wanted = new Set(matchups);
        return diagnoseResults.filter((r) => wanted.has(heroMatchup(r)?.dimension));
      },
    } : {}),
    botPolicyVersion, seedSetId, holdoutSeedSetId: stored.holdoutSeedSetId, elapsedMs: baseline.elapsedMs,
    createdAt: baseline.createdAt });
  if (!full.ok) return fail(full.error.code, full.error.message);
  const covered = new Set((diagnoseResults ?? []).map((r) => heroMatchup(r)?.dimension));
  const incomplete = requested.some((m) => !covered.has(m));
  return { ...full.value, reanalyzed: true, ...(incomplete ? { diagnosisIncomplete: true } : {}) };
}

export const reanalyzeRun = safely(reanalyzeUnsafe);
