// Automatic rounds over runFull. Round 1 scans `allMatchups` on `fromHash`; every later round scans only the matchups
// the previous scan flagged. A round proposes a patch for the flagged matchups (mirror rows are never targets),
// applies it, runs the holdout on fresh seeds for those matchups and judges it. One version record per round.
//
// input: { gameId, fromHash, data (the data for fromHash), rounds (1..5, default 3), requireApproval (default true),
//   adapter, hashData, applyPatch(data, proposal) -> { data, dataHash }, runBatch(dataHash, matchups, seeds) ->
//   MatchResult[], seedsFor(round, 'scan' | 'holdout') -> seeds (never overlapping), allMatchups (dimension strings,
//   e.g. "bari vs daewi"), botPolicyVersion, seedSetId, onProgress({ round, phase, matchesDone, totalMatches }),
//   onRecord(versionRecord), now() -> ISO string }
// returns { records, stoppedBecause: 'fair'|'not_accepted'|'regression'|'rounds'|'awaiting_approval'|'error',
//   error?, finalCheck: Report | null, headHash }. Never throws. finalCheck is one all-matchups run on the last
//   accepted hash, skipped while awaiting approval. Regression = that check shows a new extreme matchup (> 65%,
//   n >= 200) compared with the first scan; the record of the last accepted version is then marked rejected.
import { analyzePhase } from './pipeline.js';
import { runFull } from './full.js';
import { heroMatchup } from '../src/group.js';
import { isMirror, newExtremeRows } from '../src/verdict.js';
import { AnalysisError, fail, toErrorResult } from '../src/errors.js';

export const MAX_ROUNDS = 5;
const DEFAULT_ROUNDS = 3;
const SEATS = 2; // every seed is played with both seat orders

/** The root record of a version tree (the base data). */
export const baseVersionRecord = ({ gameId, dataHash, createdAt }) => ({ dataHash, parentHash: null, gameId, createdAt,
  origin: 'base', changes: [], rationale: 'base data', target: null, verdict: null, approved: true });

const sideOf = (row) => ({ rate: row.winRate, ci95: row.ci95, games: row.games });

/** The flagged matchup furthest from 50% is the record's target. */
function targetOf(flagged, baselineReport, patchedReport) {
  const before = new Map(baselineReport.rows.map((r) => [r.dimension, r]));
  const after = new Map((patchedReport?.rows ?? []).map((r) => [r.dimension, r]));
  const worst = flagged.map((d) => before.get(d)).filter(Boolean)
    .sort((a, b) => Math.abs(b.winRate - 0.5) - Math.abs(a.winRate - 0.5) || (a.dimension < b.dimension ? -1 : 1))[0];
  if (!worst) return null;
  const now = after.get(worst.dimension);
  return { matchup: worst.dimension, before: sideOf(worst), after: now ? sideOf(now) : null };
}

function checkInput(input) {
  const { gameId, fromHash, data, rounds, adapter, hashData, applyPatch, runBatch, seedsFor, allMatchups } = input;
  if (typeof gameId !== 'string' || !gameId) fail('INVALID_INPUT', 'gameId must be a string');
  if (typeof fromHash !== 'string' || !fromHash) fail('INVALID_INPUT', 'fromHash must be a string');
  if (data === null || typeof data !== 'object') fail('INVALID_INPUT', 'data must be an object');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    fail('INVALID_INPUT', `rounds must be an integer from 1 to ${MAX_ROUNDS}`);
  }
  for (const [name, fn] of Object.entries({ hashData, applyPatch, runBatch, seedsFor })) {
    if (typeof fn !== 'function') fail('INVALID_INPUT', `${name} must be a function`);
  }
  if (!adapter) fail('INVALID_INPUT', 'adapter is required');
  if (!Array.isArray(allMatchups) || allMatchups.length === 0) fail('INVALID_INPUT', 'allMatchups must not be empty');
  if (hashData(data) !== fromHash) fail('DATA_HASH_MISMATCH', 'data does not match fromHash');
}

class Run {
  constructor(input) {
    this.input = input;
    this.records = [];
  }

  progress(round, phase, matchesDone, totalMatches) {
    this.input.onProgress?.({ round, phase, matchesDone, totalMatches });
  }

  /** Runs matchups on one version; results must be pinned to it. Progress totals are an estimate (seeds x seats). */
  async batch(round, phase, dataHash, matchups, seeds) {
    const expected = matchups.length * seeds.length * SEATS;
    this.progress(round, phase, 0, expected);
    const results = await this.input.runBatch(dataHash, matchups, seeds);
    if (!Array.isArray(results) || results.some((r) => r?.config?.dataHash !== dataHash)) {
      fail('DATA_HASH_MISMATCH', `${phase} results are not pinned to the version that was run`);
    }
    this.progress(round, phase, results.length, expected);
    return results;
  }

  reportOf(results, name) {
    const { botPolicyVersion, seedSetId } = this.input;
    return analyzePhase(results, { reportId: name, ...(botPolicyVersion && { botPolicyVersion }),
      ...(seedSetId && { seedSetId }) }).report;
  }

  emit(record) {
    this.records.push(record);
    this.input.onRecord?.(record);
  }

  /** One round on `head`. Returns { stop } to end the run, or { head, scope } to continue. */
  async round(round, head, scope) {
    const { input } = this;
    const results = await this.batch(round, 'scan', head.hash, scope, input.seedsFor(round, 'scan'));
    const scanReport = this.reportOf(results, `r-scan-${round}`);
    if (round === 1) this.firstScan = scanReport;
    const flagged = scanReport.rows.filter((r) => r.outlier && !isMirror(r)).map((r) => r.dimension);
    if (flagged.length === 0) return { stop: 'fair' };
    const baselineResults = results.filter((r) => flagged.includes(heroMatchup(r)?.dimension));
    let patched = null;
    const full = await runFull({ baselineResults, baseData: head.data, adapter: input.adapter, hashData: input.hashData,
      applyPatch: (data, proposal) => {
        patched = input.applyPatch(data, proposal);
        return patched;
      }, holdoutSeeds: input.seedsFor(round, 'holdout'), botPolicyVersion: input.botPolicyVersion,
    seedSetId: input.seedSetId, createdAt: input.now(),
    runHoldout: (patchedData, seeds) => this.batch(round, 'holdout', patched.dataHash, flagged, seeds) });
    if (!full.ok) return { stop: 'error', error: full.error };
    const body = full.value;
    if (!body.validation.ok) return { stop: 'not_accepted', invalidPatch: body.validation };
    // A patch that changes nothing would make a record that is its own parent; it is simply not accepted.
    if (body.patchedDataHash === head.hash) return { stop: 'not_accepted', noChange: true };
    const accepted = body.verdict.verdict === 'accepted';
    const approved = accepted && !input.requireApproval;
    this.emit({ dataHash: body.patchedDataHash, parentHash: head.hash, gameId: input.gameId, createdAt: input.now(),
      origin: body.proposal.origin, changes: body.proposal.changes, rationale: body.proposal.rationale,
      target: targetOf(flagged, this.reportOf(baselineResults, 'r-target'), body.patched), verdict: body.verdict,
      approved, ...(approved ? { note: 'auto-approved' } : {}) });
    if (!accepted) return { stop: 'not_accepted' };
    if (!approved) return { stop: 'awaiting_approval' };
    return { head: { hash: body.patchedDataHash, data: patched.data }, scope: flagged };
  }

  /** One all-matchups run on the last accepted hash, compared with the first scan. */
  async finalCheck(head) {
    const { input } = this;
    if (head.hash === input.fromHash && this.firstScan) return { report: this.firstScan, regression: [] };
    const results = await this.batch(0, 'final_check', head.hash, input.allMatchups, input.seedsFor(1, 'scan'));
    const report = this.reportOf(results, 'r-final');
    return { report, regression: this.firstScan ? newExtremeRows(this.firstScan, report) : [] };
  }

  /** Marks the record of the last accepted version (`hash`) rejected; returns its parent hash. */
  rejectAccepted(hash, bad) {
    const reasons = bad.map((r) => `new extreme matchup: ${r.dimension} at ${Math.round(r.winRate * 100)}% `
      + 'in the final roster check');
    const index = this.records.findIndex((r) => r.dataHash === hash);
    this.records[index] = { ...this.records[index], verdict: { verdict: 'rejected', reasons }, approved: false,
      note: 'rejected by the final roster check' };
    this.input.onRecord?.(this.records[index]);
    return this.records[index].parentHash;
  }
}

async function execute(input, run) {
  let head = { hash: input.fromHash, data: input.data };
  let scope = input.allMatchups;
  let reason = 'rounds';
  let extra = {};
  for (let round = 1; round <= input.rounds; round++) {
    const next = await run.round(round, head, scope);
    if (next.stop) {
      const { stop, ...rest } = next;
      reason = stop;
      extra = rest;
      break;
    }
    ({ head, scope } = next);
  }
  if (reason === 'awaiting_approval' || reason === 'error') {
    return { records: run.records, stoppedBecause: reason, finalCheck: null, headHash: head.hash, ...extra };
  }
  const check = await run.finalCheck(head);
  if (check.regression.length) {
    const headHash = run.rejectAccepted(head.hash, check.regression);
    return { records: run.records, stoppedBecause: 'regression', finalCheck: check.report, headHash, ...extra };
  }
  return { records: run.records, stoppedBecause: reason, finalCheck: check.report, headHash: head.hash, ...extra };
}

export async function runAuto(input = {}) {
  const settings = { rounds: DEFAULT_ROUNDS, requireApproval: true, now: () => new Date().toISOString(), ...input };
  try {
    checkInput(settings);
  } catch (e) {
    return { records: [], stoppedBecause: 'error', finalCheck: null, headHash: input?.fromHash ?? null,
      error: toErrorResult(e).error };
  }
  const run = new Run(settings);
  try {
    return await execute(settings, run);
  } catch (e) {
    const error = e instanceof AnalysisError ? { code: e.code, message: e.message } : toErrorResult(e).error;
    return { records: run.records, stoppedBecause: 'error', finalCheck: null, headHash: settings.fromHash, error };
  }
}
