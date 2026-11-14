// One-call orchestration for POST /v1/playtest/full: baseline results -> report -> patch proposal -> validation ->
// holdout run on the patched data (injected, so no engine, network or clock here) -> report -> verdict.
// Returns { ok: true, value: body } or an error result; body has the shared-interface fields except the transport
// ones (runId, gameId, elapsedMs), which the server adds.
import { addHumanRows } from '../src/human.js';
import { buildEvidence } from '../src/evidence.js';
import { withExtras } from '../src/extras.js';
import { applyPatchToData } from '../src/replay.js';
import { fail, safely } from '../src/errors.js';
import { assertMatchResults } from '../src/input-check.js';
import { analyzePhase, proposeStep, verifyStep } from './pipeline.js';

const MOVE_POWER = /^\/moves\/(\d+)\/power$/;
const titleCase = (id) => String(id).split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

/** Old value and a readable label for one replacement, read from the data the patch is based on. */
function describeChange(baseData, { path, value }) {
  const move = MOVE_POWER.exec(path);
  if (!move) return { path, label: 'Damage scale (permille)', old: baseData.tuning?.damageScalePermille, new: value };
  const index = Number(move[1]);
  const moveId = baseData.moves?.[index]?.id;
  // The engine lists a hero's moves in `moveIds`; `moves` is accepted too.
  const ownsMove = (c) => [c.moveIds, c.moves].some((ids) => Array.isArray(ids) && ids.includes(moveId));
  const hero = baseData.characters?.find(ownsMove)?.id;
  const name = moveId ? `${titleCase(moveId)} power` : `Move ${index} power`;
  return { path, label: hero ? `${titleCase(hero)} · ${name}` : name, old: baseData.moves?.[index]?.power,
    new: value };
}

const seedsOf = (results) => new Set(results.map((r) => r.config.seed));

function checkSeeds(baselineResults, holdoutSeeds) {
  if (!Array.isArray(holdoutSeeds) || holdoutSeeds.length === 0 || !holdoutSeeds.every(Number.isInteger)) {
    fail('INVALID_INPUT', 'holdoutSeeds must be a non-empty array of integers');
  }
  const used = seedsOf(baselineResults);
  if (holdoutSeeds.some((s) => used.has(s))) fail('INVALID_INPUT', 'holdout seeds must not overlap baseline seeds');
}

function checkHoldoutResults(holdoutResults, holdoutSeeds, patchedDataHash) {
  assertMatchResults(holdoutResults, 'holdout results');
  const allowed = new Set(holdoutSeeds);
  if (holdoutResults.some((r) => !allowed.has(r.config.seed))) {
    fail('INVALID_INPUT', 'holdout results contain seeds that were not requested');
  }
  if (holdoutResults.some((r) => r.config.dataHash !== patchedDataHash)) {
    fail('DATA_HASH_MISMATCH', 'holdout results are not pinned to the patched data');
  }
}

const rejectedPatchVerdict = (errors) => ({ verdict: 'inconclusive',
  reasons: ['the patch did not pass validation, so no holdout run was made', ...errors.slice(0, 3)] });

/** Patched data and its hash: from the injected `applyPatch` (the engine's own) or from our pure copy. */
function patchData({ baseData, hashData, applyPatch }, proposal) {
  if (typeof applyPatch !== 'function') {
    const data = applyPatchToData(baseData, proposal, { hashData });
    return { data, dataHash: hashData(data) };
  }
  let patched;
  try {
    patched = applyPatch(baseData, proposal);
  } catch (e) {
    return fail('INVALID_PATCH', `the engine rejected the patch: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  if (!patched || typeof patched.dataHash !== 'string' || patched.data === null || typeof patched.data !== 'object') {
    fail('INVALID_INPUT', 'applyPatch must return { data, dataHash }');
  }
  return patched;
}

async function runFullUnsafe(input) {
  const { baselineResults, humanResults = [], baseData, adapter, runHoldout, holdoutSeeds, hashData,
    botPolicyVersion, seedSetId, holdoutSeedSetId, elapsedMs, createdAt } = input ?? {};
  if (typeof runHoldout !== 'function') fail('INVALID_INPUT', 'runHoldout must be a function');
  if (typeof hashData !== 'function') fail('INVALID_INPUT', 'hashData must be a function');
  if (baseData === null || typeof baseData !== 'object') fail('INVALID_INPUT', 'baseData must be an object');
  assertMatchResults(baselineResults, 'baseline results');
  assertMatchResults(humanResults, 'human results');
  checkSeeds(baselineResults, holdoutSeeds);

  const options = { ...(botPolicyVersion && { botPolicyVersion }), ...(seedSetId && { seedSetId }) };
  const base = analyzePhase(baselineResults, { reportId: 'r-baseline', ...options });
  const baseline = withExtras(addHumanRows(base.report, humanResults), { createdAt, elapsedMs });
  const evidence = buildEvidence(base.counted, baseline);
  const step = await proposeStep(baseline, adapter);
  const body = {
    botPolicyVersion: baseline.botPolicyVersion,
    seedSetId: baseline.seedSetId,
    holdoutSeedSetId: holdoutSeedSetId ?? `${baseline.seedSetId}-holdout`,
    baseline,
    evidence: evidence.ok ? evidence.value : null, // per outlier row; null only if it could not be built
    proposal: { ...step.proposal, origin: step.origin,
      changes: step.ok ? step.proposal.replacements.map((r) => describeChange(baseData, r)) : [] },
    validation: { ok: step.ok, errors: step.errors },
    humanMatches: baseline.humanMatches ?? 0,
  };
  if (!step.ok) return { ...body, patchedDataHash: null, patched: null, verdict: rejectedPatchVerdict(step.errors) };

  const { data: patchedData, dataHash: patchedDataHash } = patchData(input, step.proposal);
  let holdoutResults;
  try {
    holdoutResults = await runHoldout(patchedData, [...holdoutSeeds]);
  } catch (e) {
    return fail('SIMULATION_FAILED', `the holdout run failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  checkHoldoutResults(holdoutResults, holdoutSeeds, patchedDataHash);
  const out = verifyStep(baseline, holdoutResults, { reportId: 'r-patched', botPolicyVersion: baseline.botPolicyVersion,
    seedSetId: body.holdoutSeedSetId,
    verdict: { holdoutSeeds: true } });
  return { ...body, patchedDataHash, patched: withExtras(out.report, { createdAt }), verdict: {
    verdict: out.verdict.verdict, reasons: out.verdict.reasons } };
}

export const runFull = safely(runFullUnsafe);
