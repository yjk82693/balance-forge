// Pipeline: baseline MatchResults -> analyze -> proposePatch -> validate -> (caller applies the patch,
// produces a new dataHash and runs holdout seeds) -> analyze -> verdict.
// Steps are plain functions; only the adapter call is async. No clock: callers pass timing/time in.
import { analyze } from '../src/analyzer.js';
import { groupByDataHash, hasAssignments, isCountable, pairBySeed } from '../src/group.js';
import { validatePatch } from '../src/validator.js';
import { judgePatch } from '../src/verdict.js';
import { fail, safely } from '../src/errors.js';
import { assertMatchResults, assertReport } from '../src/input-check.js';

/** Exactly one dataHash allowed per phase (one per content version, addendum 1). */
export function singleGroup(results) {
  assertMatchResults(results);
  const groups = groupByDataHash(results.filter(isCountable));
  if (groups.size === 0) fail('NO_RESULTS', 'no valid matches in this phase');
  if (groups.size !== 1) {
    const short = [...groups.keys()].map((h) => h.slice(0, 8)).join(', ');
    fail('MIXED_DATAHASH', `expected one dataHash per phase, found ${groups.size}: ${short}`);
  }
  return [...groups.values()][0];
}

/** Analyze one phase. With hero assignments, only complete seed pairs count; the rest is reported as unpaired. */
export function analyzePhase(results, options = {}) {
  singleGroup(results);
  const invalid = results.filter((r) => !isCountable(r));
  let counted = results.filter(isCountable);
  const meta = { paired: false, pairs: 0, unpairedMatches: 0 };
  if (hasAssignments(counted)) {
    const { pairs, unpaired } = pairBySeed(counted);
    counted = pairs.flatMap((p) => p.results);
    Object.assign(meta, { paired: true, pairs: pairs.length, unpairedMatches: unpaired.length });
  }
  const report = analyze([...counted, ...invalid], options);
  return { report, meta, counted };
}

/**
 * Baseline: analyze, ask the adapter, validate. `adapter.proposeWithOrigin` falls back to proposePatch.
 * options.context ({ diagnosis }) goes to the adapter as extra input; the other options go to the validator.
 */
export async function proposeStep(report, adapter, { context = {}, ...options } = {}) {
  assertReport(report);
  if (!adapter || (typeof adapter.proposeWithOrigin !== 'function' && typeof adapter.proposePatch !== 'function')) {
    fail('INVALID_INPUT', 'adapter must provide proposeWithOrigin or proposePatch');
  }
  let got;
  try {
    got = adapter.proposeWithOrigin
      ? await adapter.proposeWithOrigin(report, context)
      : { proposal: await adapter.proposePatch(report, context), origin: 'custom' };
  } catch (e) {
    return fail('ADAPTER_FAILED', `the patch adapter failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  const check = validatePatch(got.proposal, { baseDataHash: report.dataHash, rootData: context.rootData, ...options });
  return { proposal: got.proposal, origin: got.origin, fallbackReason: got.fallbackReason, ok: check.ok,
    errors: check.errors };
}

/** After the caller applied the patch and ran holdout seeds. */
export function verifyStep(baselineReport, holdoutResults, options = {}) {
  assertReport(baselineReport, 'baseline report');
  const { report, meta } = analyzePhase(holdoutResults, options);
  const verdict = judgePatch(baselineReport, report, options.verdict);
  return { report, meta, verdict };
}

/** Result-returning versions for callers that must never see an exception. */
export const safe = {
  analyzePhase: safely(analyzePhase),
  proposeStep: safely(proposeStep),
  verifyStep: safely(verifyStep),
};
