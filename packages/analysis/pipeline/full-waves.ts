// One-call orchestration of POST /v1/playtest/full for Tentacle Run: baseline runs -> per-wave table -> flag the wave
// -> proposal (wave paths only) -> validation -> holdout runs on fresh seeds -> per-wave verdict. Same shape of
// injected pieces as pipeline/full.ts (no engine, network or clock here).
import { flaggedWave, judgeWaves, waveReport, waveTable, DEFAULT_WAVE_TARGETS } from '../src/waves.ts';
import { applyPatchToData } from '../src/replay.ts';
import { assertMatchResults } from '../src/input-check.ts';
import { withExtras } from '../src/extras.ts';
import { fail, safely } from '../src/errors.ts';
import { proposeStep } from './pipeline.ts';

const CHANGE_FIELD = /^\/gameRules\/waves\/(\d)\/(\w+)$/;
const LABELS: Record<string, string> = { walkers: 'Walkers', drones: 'Drones', sentries: 'Sentries',
  enemySpeed: 'Enemy speed',
  enemyDamage: 'Enemy damage', fireIntervalTicks: 'Fire interval (ticks)' };
const describeChange = (baseData: any, { path, value }: { path: string; value: number }) => {
  const m = CHANGE_FIELD.exec(path);
  const wave = m ? Number(m[1]) : -1;
  return { path, label: m ? `Wave ${wave + 1} · ${LABELS[m[2]] ?? m[2]}` : path,
    old: m ? baseData.gameRules?.waves?.[wave]?.[m[2]] : undefined, new: value };
};

async function runFullWavesUnsafe(input: any) {
  const { baselineResults, baseData, rootData, adapter, runHoldout, holdoutSeeds, hashData, botPolicyVersion, seedSetId,
    holdoutSeedSetId, elapsedMs, createdAt, targets = DEFAULT_WAVE_TARGETS,
    simVersion = 'tentacle-0.1.0' } = input ?? {};
  if (typeof runHoldout !== 'function' || typeof hashData !== 'function') {
    fail('INVALID_INPUT', 'runHoldout and hashData are needed');
  }
  if (!Array.isArray(holdoutSeeds) || !holdoutSeeds.length) {
    fail('INVALID_INPUT', 'holdoutSeeds must be a non-empty array');
  }
  assertMatchResults(baselineResults, 'baseline results');
  const used = new Set(baselineResults.map((r: any) => r.config.seed));
  if (holdoutSeeds.some((s: number) => used.has(s))) {
    fail('INVALID_INPUT', 'holdout seeds must not overlap baseline seeds');
  }
  const dataHash = hashData(baseData);
  const table = waveTable(baselineResults, { targets });
  const baseline = { dataHash, ...table };
  const head = { botPolicyVersion, simVersion, seedSetId, holdoutSeedSetId: holdoutSeedSetId ?? `${seedSetId}-holdout`,
    runs: baselineResults.length, holdoutRuns: holdoutSeeds.length,
    baseline: withExtras(baseline as any, { elapsedMs, createdAt }),
    humanRuns: 0 };
  const flagged = flaggedWave(table);
  if (!flagged) {
    return { ...head, fair: true, flaggedWave: null, proposal: null, validation: null, patchedDataHash: null,
      patched: null, verdict: { verdict: 'inconclusive',
        reasons: ['no wave is flagged: every wave is within reach of its target'] } };
  }

  const report = waveReport(table, { dataHash, botPolicyVersion, simVersion, seedSetId });
  const step: any = await proposeStep(report, adapter, { context: { rootData: rootData ?? baseData,
    waveTable: table, flaggedWave: flagged } });
  const body: any = { ...head, fair: false, flaggedWave: flagged,
    proposal: { ...step.proposal, origin: step.origin,
      ...(step.fallbackReason ? { fallbackReason: step.fallbackReason } : {}),
      changes: step.ok ? step.proposal.replacements.map((r: any) => describeChange(baseData, r)) : [] },
    validation: { ok: step.ok, errors: step.errors } };
  if (!step.ok) return { ...body, patchedDataHash: null, patched: null, verdict: { verdict: 'inconclusive', reasons: [
    'the patch did not pass validation, so no holdout run was made', ...step.errors.slice(0, 3)], targets: [] } };

  const patchedData = applyPatchToData(baseData, step.proposal, { hashData, rootData: rootData ?? baseData });
  const patchedDataHash = hashData(patchedData);
  let holdoutResults;
  try {
    holdoutResults = await runHoldout(patchedData, [...holdoutSeeds]);
  } catch (e: any) {
    return fail('SIMULATION_FAILED', `the holdout run failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  assertMatchResults(holdoutResults, 'holdout results');
  if (holdoutResults.some((r: any) => r.config.dataHash !== patchedDataHash)) {
    fail('DATA_HASH_MISMATCH', 'holdout results are not pinned to the patched data');
  }
  const after = waveTable(holdoutResults, { targets });
  return { ...body, patchedDataHash, patched: withExtras({ dataHash: patchedDataHash, ...after } as any, { createdAt }),
    verdict: judgeWaves(table, after) };
}

export const runFullWaves = safely(runFullWavesUnsafe);
