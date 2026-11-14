// One-call orchestration for POST /v1/playtest/full: baseline results -> report -> patch proposal -> validation ->
// holdout run on the patched data (injected, so no engine, network or clock here) -> report -> verdict.
// Returns { ok: true, value: body } or an error result; body has the shared-interface fields except the transport
// ones (runId, gameId, elapsedMs), which the server adds.
import { addHumanRows } from '../src/human.ts';
import { buildDiagnosis, diagnosisMatchups, focusMatchupOf, heroOverallRows } from '../src/diagnose.ts';
import { buildEvidence } from '../src/evidence.ts';
import { buildCardDiagnosis, cardVariants } from '../src/card-diagnose.ts';
import { targetFor } from '../src/intent.ts';
import { heroMatchup } from '../src/group.ts';
import { isMirror } from '../src/verdict.ts';
import { HUMAN_PREFIX, withExtras } from '../src/extras.ts';
import { applyPatchToData } from '../src/replay.ts';
import { fail, safely } from '../src/errors.ts';
import { assertMatchResults } from '../src/input-check.ts';
import { analyzePhase, proposeStep, verifyStep } from './pipeline.ts';

const MOVE_POWER = /^\/moves\/(\d+)\/power$/;
const CARD_FIELD = /^\/gameRules\/cards\/(\d+)\/(cost|power)$/;
const HERO_STAT = /^\/characters\/(\d+)\/(health|speed)$/;
const titleCase = (id) => String(id).split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

/** Old value and a readable label for one replacement, read from the data the patch is based on. */
function describeChange(baseData, { path, value }) {
  const cardField = CARD_FIELD.exec(path);
  if (cardField) {
    const card = baseData.gameRules?.cards?.[Number(cardField[1])];
    return { path, label: `${titleCase(card?.id ?? `Card ${cardField[1]}`)} · ${titleCase(cardField[2])}`,
      old: card?.[cardField[2]], new: value };
  }
  const stat = HERO_STAT.exec(path);
  if (stat) {
    const hero = baseData.characters?.[Number(stat[1])];
    return { path, label: `${titleCase(hero?.id ?? `Character ${stat[1]}`)} · ${titleCase(stat[2])}`,
      old: hero?.[stat[2]], new: value };
  }
  const move = MOVE_POWER.exec(path);
  if (!move) return { path, label: 'Damage scale (permille)', old: baseData.tuning?.damageScalePermille, new: value };
  const index = Number(move[1]);
  const moveId = baseData.moves?.[index]?.id;
  // The engine lists a hero's moves in `moveIds`; `moves` is accepted too.
  const ownsMove = (c) => [c.moveIds, c.moves].some((ids) => Array.isArray(ids) && ids.includes(moveId));
  const owners = (baseData.characters ?? []).filter(ownsMove).map((c) => c.id);
  const name = moveId ? `${titleCase(moveId)} power` : `Move ${index} power`;
  // A move that several heroes own changes all of them; the label says so instead of naming one owner.
  const label = owners.length === 1 ? `${titleCase(owners[0])} · ${name}`
    : owners.length > 1 ? `${name} (shared: ${owners.map(titleCase).join(', ')})` : name;
  return { path, label, old: baseData.moves?.[index]?.power, new: value };
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

const rejectedPatchVerdict = (errors) => ({ verdict: 'inconclusive', targets: [],
  reasons: ['the patch did not pass validation, so no holdout run was made', ...errors.slice(0, 3)] });

/** Patched data and its hash: from the injected `applyPatch` (the engine's own) or from our pure copy. */
function patchData({ baseData, rootData, hashData, applyPatch }, proposal) {
  if (typeof applyPatch !== 'function') {
    const data = applyPatchToData(baseData, proposal, { hashData, rootData: rootData ?? baseData });
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

/**
 * A matchup inside the fair band needs no patch: stop after the baseline. No adapter call (no LLM cost) and no
 * holdout run.
 * `validation`, `patched` and `patchedDataHash` are null because nothing was proposed or applied.
 */
function fairBody(baseline, evidence, holdoutSeedSetId, extra: any = {}) {
  return {
    ...extra,
    botPolicyVersion: baseline.botPolicyVersion,
    seedSetId: baseline.seedSetId,
    holdoutSeedSetId: holdoutSeedSetId ?? `${baseline.seedSetId}-holdout`,
    baseline,
    evidence,
    diagnosis: null,
    fair: true,
    proposal: null,
    validation: null,
    patchedDataHash: null,
    patched: null,
    verdict: { verdict: 'inconclusive', reasons: ['no outlier: the matchup is within the fair band'] },
    humanMatches: baseline.humanMatches ?? 0,
  };
}

/**
 * Diagnosis for the focus matchup: the focus heroes against every other hero, run by the injected `runDiagnose`
 * (matchups, seeds) on fresh seeds. Returns { value } or { error }; a failed diagnosis never stops the run.
 */
/**
 * Hero Cards: the card levers of the focus deck matchup, each probed by the injected `runCardProbe(variants, seeds)`,
 * which resolves [{ variant, results }] with variant null for the unchanged data (all on the same fresh seeds).
 */
async function cardDiagnoseStep(input, baseline) {
  const { baselineResults, baseData, holdoutSeeds, diagnoseSeeds, runCardProbe } = input;
  const matchup = focusMatchupOf(baseline);
  if (!matchup || typeof runCardProbe !== 'function') return { value: null };
  if (!Array.isArray(diagnoseSeeds) || diagnoseSeeds.length === 0 || !diagnoseSeeds.every(Number.isInteger)) {
    fail('INVALID_INPUT', 'diagnoseSeeds must be a non-empty array of integers');
  }
  const taken = new Set([...baselineResults.map((r) => r.config.seed), ...holdoutSeeds]);
  if (diagnoseSeeds.some((seed) => taken.has(seed))) {
    fail('INVALID_INPUT', 'diagnose seeds must not overlap other seeds');
  }
  let probes;
  try {
    probes = await runCardProbe(cardVariants(baseData, matchup.split(' vs ')), [...diagnoseSeeds]);
  } catch (e) {
    return fail('SIMULATION_FAILED', `the card probe run failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  for (const probe of probes) assertMatchResults(probe.results, 'card probe results');
  const unchanged = probes.find((p) => p.variant === null);
  if (unchanged?.results.some((r) => r.config.dataHash !== baseline.dataHash)) {
    fail('DATA_HASH_MISMATCH', 'the unchanged probe is not pinned to the baseline data');
  }
  const row = baseline.rows.find((r) => r.dimension === matchup);
  const own = baselineResults.filter((r) => heroMatchup(r)?.dimension === matchup);
  const built = (() => {
    try {
      return { value: buildCardDiagnosis({ matchup, baselineRate: row?.winRate, baselineResults: own, probes,
        target: row?.target ?? targetFor(matchup, input.intent) }) };
    } catch (e) {
      return { error: { code: e?.code ?? 'INTERNAL', message: String(e?.message ?? e).slice(0, 120) } };
    }
  })();
  return built;
}

async function diagnoseStep(input, baseline) {
  const { baselineResults, baseData, holdoutSeeds, diagnoseSeeds, runDiagnose } = input;
  if (input.diagnosis) return { value: input.diagnosis };
  if (baseData.gameRules?.cards?.length) return cardDiagnoseStep(input, baseline);
  if (typeof runDiagnose !== 'function') return { value: null };
  const matchup = focusMatchupOf(baseline);
  const heroIds = (baseData.characters ?? []).map((c) => c.id);
  const matchups = matchup ? diagnosisMatchups(matchup, heroIds) : [];
  if (matchups.length === 0) return { value: null };
  if (!Array.isArray(diagnoseSeeds) || diagnoseSeeds.length === 0 || !diagnoseSeeds.every(Number.isInteger)) {
    fail('INVALID_INPUT', 'diagnoseSeeds must be a non-empty array of integers');
  }
  const taken = new Set([...baselineResults.map((r) => r.config.seed), ...holdoutSeeds]);
  if (diagnoseSeeds.some((seed) => taken.has(seed))) {
    fail('INVALID_INPUT', 'diagnose seeds must not overlap other seeds');
  }
  let results;
  try {
    results = await runDiagnose(matchups, [...diagnoseSeeds]);
  } catch (e) {
    return fail('SIMULATION_FAILED', `the diagnosis run failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  assertMatchResults(results, 'diagnosis results');
  if (results.some((r) => r.config.dataHash !== baseline.dataHash)) {
    fail('DATA_HASH_MISMATCH', 'diagnosis results are not pinned to the baseline data');
  }
  const own = baselineResults.filter((r) => heroMatchup(r)?.dimension === matchup);
  const built = buildDiagnosis([...own, ...results], { matchup, data: baseData, intent: input.intent });
  return built.ok ? { value: built.value } : { error: built.error };
}

async function runFullUnsafe(input) {
  const { baselineResults, humanResults = [], baseData, adapter, runHoldout, holdoutSeeds, hashData,
    botPolicyVersion, seedSetId, holdoutSeedSetId, elapsedMs, createdAt, intent } = input ?? {};
  if (typeof runHoldout !== 'function') fail('INVALID_INPUT', 'runHoldout must be a function');
  if (typeof hashData !== 'function') fail('INVALID_INPUT', 'hashData must be a function');
  if (baseData === null || typeof baseData !== 'object') fail('INVALID_INPUT', 'baseData must be an object');
  assertMatchResults(baselineResults, 'baseline results');
  assertMatchResults(humanResults, 'human results');
  checkSeeds(baselineResults, holdoutSeeds);

  const options = { ...(botPolicyVersion && { botPolicyVersion }), ...(seedSetId && { seedSetId }),
    ...(intent !== undefined && { intent }) };
  const base = analyzePhase(baselineResults, { reportId: 'r-baseline', ...options });
  const baseline = withExtras(addHumanRows(base.report, humanResults), { createdAt, elapsedMs });
  const evidence = buildEvidence(base.counted, baseline);
  const evidenceBody = evidence.ok ? evidence.value : null; // null only if it could not be built
  // With a design intent the body says which one it used, and flags a hero far from 50% overall.
  const intentFields = intent === undefined ? {} : { intentVersion: baseline.intentVersion,
    heroOverall: heroOverallRows(base.counted) };
  const flagged = baseline.rows.some((r) => r.outlier && !r.dimension.startsWith(HUMAN_PREFIX) && !isMirror(r));
  if (!flagged) return fairBody(baseline, evidenceBody, holdoutSeedSetId, intentFields);
  const diagnosed = await diagnoseStep(input, baseline);
  const context = { rootData: input.rootData ?? baseData, ...(intent !== undefined && { intent }),
    ...(diagnosed.value ? { diagnosis: diagnosed.value } : {}) };
  const step = await proposeStep(baseline, adapter, { context });
  const body = {
    ...intentFields,
    botPolicyVersion: baseline.botPolicyVersion,
    seedSetId: baseline.seedSetId,
    holdoutSeedSetId: holdoutSeedSetId ?? `${baseline.seedSetId}-holdout`,
    baseline,
    evidence: evidenceBody,
    diagnosis: diagnosed.value ?? null,
    ...(diagnosed.error ? { diagnosisError: diagnosed.error } : {}),
    fair: false,
    // A fallback says why the model's answer was not used (never a body or a key), so it shows in the response.
    proposal: { ...step.proposal, origin: step.origin,
      ...(step.fallbackReason ? { fallbackReason: step.fallbackReason } : {}),
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
    seedSetId: body.holdoutSeedSetId, ...(intent !== undefined && { intent }),
    verdict: { holdoutSeeds: true } });
  const { verdict, reasons, targets } = out.verdict;
  return { ...body, patchedDataHash, patched: withExtras(out.report, { createdAt }), verdict: { verdict, reasons,
    targets } };
}

export const runFull = safely(runFullUnsafe);
