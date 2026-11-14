// Pipeline: baseline MatchResults -> analyze -> proposePatch -> validate -> (caller applies the patch,
// produces a new dataHash and runs holdout seeds) -> analyze -> verdict.
// Steps are plain functions; only the adapter call is async. No clock: callers pass timing/time in.
import { analyze } from '../src/analyzer.js';
import { groupByDataHash, hasAssignments, pairBySeed } from '../src/group.js';
import { validatePatch } from '../src/validator.js';
import { judgePatch } from '../src/verdict.js';

/** Exactly one dataHash allowed per phase (one per content version, addendum 1). */
export function singleGroup(results) {
  const groups = groupByDataHash(results.filter((r) => r.valid));
  if (groups.size !== 1) {
    throw new Error(`expected one dataHash per phase, found ${groups.size}: ${[...groups.keys()].map((h) => h.slice(0, 8)).join(', ') || 'none'}`);
  }
  return [...groups.values()][0];
}

/** Analyze one phase. With hero assignments, only complete seed pairs count; the rest is reported as unpaired. */
export function analyzePhase(results, options = {}) {
  singleGroup(results);
  const invalid = results.filter((r) => !r.valid);
  let counted = results.filter((r) => r.valid);
  const meta = { paired: false, pairs: 0, unpairedMatches: 0 };
  if (hasAssignments(counted)) {
    const { pairs, unpaired } = pairBySeed(counted);
    counted = pairs.flatMap((p) => p.results);
    Object.assign(meta, { paired: true, pairs: pairs.length, unpairedMatches: unpaired.length });
  }
  const report = analyze([...counted, ...invalid], options);
  return { report, meta };
}

/** Baseline: analyze, ask the adapter, validate. `adapter.proposeWithOrigin` falls back to proposePatch. */
export async function proposeStep(report, adapter, options = {}) {
  const got = adapter.proposeWithOrigin
    ? await adapter.proposeWithOrigin(report)
    : { proposal: await adapter.proposePatch(report), origin: 'custom' };
  const check = validatePatch(got.proposal, { baseDataHash: report.dataHash, ...options });
  return { proposal: got.proposal, origin: got.origin, ok: check.ok, errors: check.errors };
}

/** After the caller applied the patch and ran holdout seeds. */
export function verifyStep(baselineReport, holdoutResults, options = {}) {
  const { report, meta } = analyzePhase(holdoutResults, options);
  const verdict = judgePatch(baselineReport, report, options.verdict);
  return { report, meta, verdict };
}
