// Automatic rounds over runFull. Round 1 scans `allMatchups` on `fromHash`; every later round scans only the matchups
// the previous scan flagged. A round diagnoses the most lopsided flagged matchup (both heroes against every other
// hero), picks the hero the diagnosis recommends and proposes a patch for that hero's flagged matchups (mirror rows
// are never targets; without a diagnosis see focusTargets), applies it, runs the holdout on fresh seeds for those
// matchups and judges it. Up to three candidate patches per round, each its own version record (siblings). If no
// candidate is accepted the hero is not abandoned silently: it goes to `needs_designer` (what was tried, how each lever
// came out, the evidence) and the next hero is worked on in the next round.
//
// input: { gameId, fromHash, data (the data for fromHash), rounds (1..5, default 3), requireApproval (default true),
//   rootData (the original game data that hero-stat bounds are measured against; default: `data`),
//   intent (optional design intent: rows are judged against their intended rates, see src/intent.js),
//   adapter, hashData, applyPatch(data, proposal) -> { data, dataHash }, runBatch(dataHash, matchups, seeds) ->
//   MatchResult[], seedsFor(round, 'scan' | 'holdout') -> seeds (never overlapping), allMatchups (dimension strings,
//   e.g. "bari vs daewi"), botPolicyVersion, seedSetId, onProgress({ round, phase, matchesDone, totalMatches }),
//   onRecord(versionRecord), now() -> ISO string, explain({ hero, matchup }) -> string (optional: replay findings for
//   the hand-over to a designer) }
// returns { records, stoppedBecause: 'fair'|'needs_designer'|'regression'|'rounds'|'awaiting_approval'|'error',
//   error?, finalCheck: Report | null, headHash, diagnoses: [{ round, diagnosis }], needs_designer: [{ hero, tried:
//   [{ label, path, old, new, outcome }], evidence }] }. Never throws. The run stops only when nothing is flagged
//   ('fair'), the rounds are used up ('rounds'), every flagged hero has been handed to a designer ('needs_designer'),
//   a person has to approve ('awaiting_approval'), the final check finds a regression, or on an error. finalCheck is
//   one all-matchups run on the last accepted hash, skipped while awaiting approval. Regression = that check shows a
//   new extreme matchup (> 65%, n >= 200) compared with the first scan; the record of the last accepted version is
//   then marked rejected.
import { analyzePhase } from './pipeline.ts';
import { runFull } from './full.ts';
import { buildDiagnosis, diagnosisMatchups } from '../src/diagnose.ts';
import { heroMatchup } from '../src/group.ts';
import { isMirror, newExtremeRows } from '../src/verdict.ts';
import { AnalysisError, fail, toErrorResult } from '../src/errors.ts';

export const MAX_ROUNDS = 5;
const DEFAULT_ROUNDS = 3;
const MAX_CANDIDATES = 3; // candidates per round, tried in recommendation order
const SEATS = 2; // every seed is played with both seat orders

/** The root record of a version tree (the base data). */
export const baseVersionRecord = ({ gameId, dataHash, createdAt }) => ({ dataHash, parentHash: null, gameId, createdAt,
  origin: 'base', changes: [], rationale: 'base data', target: null, verdict: null, approved: true });

/**
 * One round fixes one hero: the hero that appears in the most flagged matchups (ties: alphabetical order), and only the
 * flagged matchups with that hero are the round's targets. A patch changes a few numbers, so asking it to improve every
 * flagged matchup of the whole roster at once cannot be accepted. The other flagged matchups are scanned again in the
 * next round.
 */
export function focusTargets(flagged) {
  const counts = new Map();
  for (const dimension of flagged) {
    for (const hero of new Set(dimension.split(' vs '))) counts.set(hero, (counts.get(hero) ?? 0) + 1);
  }
  const focus = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : 1))[0];
  return focus === undefined ? [] : flagged.filter((d) => d.split(' vs ').includes(focus));
}

/**
 * One candidate per recommendation, at most two, each as a diagnosis whose first recommendation is that one (the
 * adapter prefers the first). Only the focus hero's recommendations are candidates: they share the round's target
 * matchups.
 * Without a diagnosis (or without recommendations) there is one plain candidate.
 */
export function candidateDiagnoses(diagnosis, focusHero) {
  const recs = (diagnosis?.recommendations ?? []).filter((r) => focusHero === null || r.hero === focusHero);
  if (!diagnosis || recs.length === 0) return [diagnosis ?? null];
  const picked = [];
  for (const rec of recs) if (!picked.some((p) => p.path === rec.path)) picked.push(rec);
  return picked.slice(0, MAX_CANDIDATES).map((rec) => ({ ...diagnosis, recommendations: [rec,
    ...diagnosis.recommendations.filter((r) => r !== rec)] }));
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const worstOf = (rows) => [...rows].sort((a, b) =>
  Math.abs(b.before.rate - 0.5) - Math.abs(a.before.rate - 0.5))[0].matchup;

/** One or two sentences with the numbers: how lopsided the hero is and what the levers did. */
function evidenceText(hero, entry, tried, rows) {
  const worst = [...rows].sort((a, b) => Math.abs(b.before.rate - 0.5) - Math.abs(a.before.rate - 0.5))[0];
  const where = worst ? ` Worst matchup: ${worst.matchup} at ${pct(worst.before.rate)} (${worst.before.games} games), `
    + `${pct(worst.after.rate)} after the last lever tried.` : '';
  const overall = entry ? `${hero} wins ${pct(entry.overall.rate)} overall (${entry.overall.games} games, ` +
    `${entry.strength.marginPts > 0 ? '+' : ''}${entry.strength.marginPts} points from 50%).` : `${hero} is flagged.`;
  const levers = tried.map((t) => `${t.label ?? t.path} ${t.outcome}`).join(', ');
  return `${overall} ${tried.length} lever(s) tried (${levers}), none moved a flagged matchup beyond noise.${where}`;
}

/** One lever of a hero as handed to a designer: what was tried and how it came out. */
function leverOutcome(variant, outcome) {
  const rec = variant?.recommendations?.[0] ?? null;
  const base = { path: rec?.path ?? null, label: rec?.path ?? null, old: null, new: null, direction: rec?.direction,
    sizePct: rec?.sizePct, ...(outcome.origin ? { origin: outcome.origin } : {}),
    ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}) };
  if (outcome.skipped) return { ...base, outcome: 'skipped', reason: outcome.reason };
  const { verdict, reasons, targets } = outcome.record.verdict;
  const change = outcome.record.changes[0];
  return { ...base, path: change.path, label: change.label ?? change.path, old: change.old, new: change.new,
    outcome: verdict, dataHash: outcome.record.dataHash, reasons, targets };
}

/** Summed improvement of a verdict's targets: how many points closer to 50% (negative when further away). */
export function improvement(targets = []) {
  return targets.reduce((sum, t) => sum + Math.abs(t.before.rate - 0.5) - Math.abs(t.after.rate - 0.5), 0);
}

const sideOf = (row) => ({ rate: row.winRate, ci95: row.ci95, games: row.games });

/** The flagged matchup furthest from 50% is the record's target. */
// How far a row is from its target (50% without a design intent).
const gapOf = (row) => Math.abs(row.deltaToTarget ?? row.winRate - 0.5);

function targetOf(flagged, baselineReport, patchedReport) {
  const before = new Map(baselineReport.rows.map((r) => [r.dimension, r]));
  const after = new Map((patchedReport?.rows ?? []).map((r) => [r.dimension, r]));
  const worst = flagged.map((d) => before.get(d)).filter(Boolean)
    .sort((a, b) => gapOf(b) - gapOf(a) || (a.dimension < b.dimension ? -1 : 1))[0];
  if (!worst) return null;
  const now = after.get(worst.dimension);
  if (!now) return null; // the version record shape needs both sides; no holdout rows for it means no target
  return { matchup: worst.dimension, before: sideOf(worst), after: sideOf(now) };
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
  declare input: any;
  declare records: any[];
  declare diagnoses: any[];
  declare candidates: any[];
  declare needsDesigner: any[];
  declare escalated: Set<string>;
  declare diagnosisCache: Map<string, any>;
  declare seen: Set<string>;
  declare firstScan: any;
  constructor(input: any) {
    this.input = input;
    this.records = [];
    this.diagnoses = [];
    this.candidates = []; // per candidate: where its patch came from (and why a model answer was not used)
    this.needsDesigner = []; // heroes the numbers could not fix: { hero, round, matchups, levers, evidence, ... }
    this.escalated = new Set();
    this.diagnosisCache = new Map();
    this.seen = new Set(); // data hashes already recorded: a version is never tried twice
  }

  /**
   * Both heroes of the focus matchup against every other hero. Matchups the scan already covered are reused; the
   * rest run on the round's scan seeds (phase "diagnose"). Null when it cannot be built; the round carries on.
   */
  async diagnose(round, head, matchup, scanResults) {
    const key = `${head.hash}|${matchup}`;
    if (this.diagnosisCache.has(key)) return this.diagnosisCache.get(key);
    const heroIds = (head.data.characters ?? []).map((c) => c.id);
    if (!matchup || heroIds.length < 3) return null;
    const have = new Set(scanResults.map((r) => heroMatchup(r)?.dimension));
    const missing = diagnosisMatchups(matchup, heroIds).filter((d) => !have.has(d));
    const extra = missing.length ? await this.batch(round, 'diagnose', head.hash, missing,
      this.input.seedsFor(round, 'scan')) : [];
    const built = buildDiagnosis([...scanResults, ...extra], { matchup, data: head.data,
      rootData: this.input.rootData ?? this.input.data,
      ...(this.input.intent !== undefined && { intent: this.input.intent }) });
    this.diagnosisCache.set(key, built.ok ? built.value : null);
    return built.ok ? built.value : null;
  }

  /**
   * The next hero to work on: flagged matchups from the most lopsided down, each diagnosed, the first whose recommended
   * hero has not been handed to a designer yet. Without a diagnosis the hero in the most flagged matchups that is still
   * open. Null when every flagged hero has been escalated.
   */
  async pickFocus(round, head, scanReport, results, flagged) {
    const distance = (d) => gapOf(scanReport.rows.find((r) => r.dimension === d) ?? { winRate: 0.5 });
    const ranked = [...flagged].sort((a, b) => distance(b) - distance(a) || (a < b ? -1 : 1));
    let anyDiagnosis = false;
    for (const matchup of ranked) {
      const diagnosis = await this.diagnose(round, head, matchup, results);
      if (!diagnosis?.focusHero) continue;
      anyDiagnosis = true;
      if (this.escalated.has(diagnosis.focusHero)) continue;
      const targets = flagged.filter((d) => d.split(' vs ').includes(diagnosis.focusHero));
      return { diagnosis, hero: diagnosis.focusHero, targets, matchup };
    }
    if (anyDiagnosis) return null; // diagnosed, and every recommended hero has been escalated
    const counts = new Map();
    for (const d of flagged) for (const h of d.split(' vs ')) counts.set(h, (counts.get(h) ?? 0) + 1);
    const hero = [...counts.keys()].filter((h) => !this.escalated.has(h))
      .sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : 1))[0];
    if (hero === undefined) return null;
    return { diagnosis: null, hero, targets: flagged.filter((d) => d.split(' vs ').includes(hero)),
      matchup: ranked[0] };
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
      ...(seedSetId && { seedSetId }), ...(this.input.intent !== undefined && { intent: this.input.intent }) }).report;
  }

  emit(record) {
    this.seen.add(record.dataHash);
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
    // The diagnosis picks the hero: a weak hero is buffed, a strong one nerfed, whichever side of the flagged matchup
    // it is on. A hero the numbers could not fix is handed to a designer and the next hero is worked on.
    const focus = await this.pickFocus(round, head, scanReport, results, flagged);
    if (focus === null) return { stop: 'needs_designer' };
    const { diagnosis, targets } = focus;
    const baselineResults = results.filter((r) => targets.includes(heroMatchup(r)?.dimension));
    if (diagnosis) this.diagnoses.push({ round, diagnosis });
    const round_ = { round, head, flagged, targets, baselineResults, hero: focus.hero };
    const variants = candidateDiagnoses(diagnosis, diagnosis ? focus.hero : null);
    const outcomes: any[] = [];
    const tried = [];
    for (const [index, variant] of variants.entries()) {
      const outcome: any = await this.candidate(round_, variant, index, variants.length);
      if (outcome.failed) return outcome.stop; // an error of the run itself
      tried.push(leverOutcome(variant, outcome));
      this.candidates.push({ round, candidate: index + 1, origin: outcome.origin ?? null,
        ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
        outcome: outcome.skipped ? 'skipped' : outcome.record.verdict.verdict,
        ...(outcome.skipped ? { reason: outcome.reason } : { dataHash: outcome.record.dataHash }) });
      if (outcome.skipped) continue;
      if (outcomes.some((o) => o.record?.dataHash === outcome.record.dataHash)) {
        tried[tried.length - 1] = { ...tried[tried.length - 1], outcome: 'skipped', reason: 'the same version again' };
        continue;
      }
      outcomes.push(outcome);
    }
    const chosen = this.choose(round_, outcomes);
    if (chosen.stop !== 'not_accepted') return chosen;
    await this.escalate(round_, diagnosis, tried, outcomes);
    return { head, scope: flagged }; // nothing changed: the next round works on the next hero
  }

  /** The optional injected `explain({ hero, matchup })` (a replay of the pair); a failure never stops the run. */
  async explain(hero, matchup) {
    if (typeof this.input.explain !== 'function' || !matchup) return null;
    try {
      const text = await this.input.explain({ hero, matchup });
      return typeof text === 'string' && text ? text.slice(0, 1500) : null;
    } catch {
      return null;
    }
  }

  /**
   * Hands a hero to a designer: what was tried and how each lever came out, plus the evidence in plain words with the
   * numbers. Not a version record. Shape for the screen:
   * { hero, tried: [{ label, path, old, new, outcome }], evidence }.
   */
  async escalate({ round, hero, targets }, diagnosis, tried, outcomes) {
    this.escalated.add(hero);
    const entry = diagnosis?.heroes.find((h) => h.hero === hero) ?? null;
    const rows = tried.find((t) => t.targets)?.targets ?? [];
    const replay = await this.explain(hero, rows.length ? worstOf(rows) : targets[0]);
    this.needsDesigner.push({ hero, round, matchups: targets,
      tried: tried.map(({ label, path, old, new: value, outcome, reason, origin, fallbackReason }) => ({ label, path,
        old, new: value, outcome, ...(reason ? { reason } : {}), ...(origin ? { origin } : {}),
        ...(fallbackReason ? { fallbackReason } : {}) })),
      evidence: [evidenceText(hero, entry, tried, rows), replay].filter(Boolean).join(' '),
      rawEvidence: outcomes.find((o) => o.evidence)?.evidence ?? null });
  }

  /**
   * One candidate: the adapter is asked with this candidate's recommendation first, the patch is validated and applied,
   * the holdout runs on the round's fresh seeds for the target matchups, and the verdict is judged. Nothing is emitted
   * here: both candidates are compared first.
   */
  async candidate({ round, head, flagged, targets, baselineResults }, diagnosis, index, count) {
    const { input } = this;
    let patched = null;
    const rootData = input.rootData ?? input.data;
    const full = await runFull({ baselineResults, baseData: head.data, rootData, diagnosis, adapter: input.adapter,
      ...(input.intent !== undefined && { intent: input.intent }),
      hashData: input.hashData,
      applyPatch: (data, proposal) => {
        patched = input.applyPatch(data, proposal);
        return patched;
      }, holdoutSeeds: input.seedsFor(round, 'holdout'), botPolicyVersion: input.botPolicyVersion,
    seedSetId: input.seedSetId, createdAt: input.now(),
    runHoldout: (patchedData, seeds) => this.batch(round, 'holdout', patched.dataHash, targets, seeds) });
    if (!full.ok) return { failed: true, stop: { stop: 'error', error: full.error } };
    const body = full.value;
    const from = { origin: body.proposal.origin, fallbackReason: body.proposal.fallbackReason };
    if (!body.validation.ok) {
      return { skipped: true, ...from, reason: `invalid patch: ${body.validation.errors[0] ?? ''}` };
    }
    // A patch that changes nothing would make a record that is its own parent; it is simply not accepted.
    if (body.patchedDataHash === head.hash) return { skipped: true, ...from, reason: 'the patch changes nothing' };
    if (this.seen.has(body.patchedDataHash)) {
      return { skipped: true, ...from, reason: 'this version was already tried' };
    }
    const accepted = body.verdict.verdict === 'accepted';
    const record = { dataHash: body.patchedDataHash, parentHash: head.hash, gameId: input.gameId,
      createdAt: input.now(), origin: body.proposal.origin, changes: body.proposal.changes,
      rationale: body.proposal.rationale, target: targetOf(targets, this.reportOf(baselineResults, 'r-target'),
        body.patched), verdict: body.verdict, approved: false,
      ...(count > 1 ? { note: `candidate ${index + 1} of ${count}` } : {}) };
    return { record, accepted, gain: improvement(body.verdict.targets), data: patched.data, flagged,
      evidence: body.evidence, ...from };
  }

  /** Emits every candidate as a sibling record and continues from the accepted one that improved most. */
  choose({ flagged }, outcomes) {
    const accepted = outcomes.filter((o) => o.accepted);
    const best = accepted.reduce((top, o) => (top === null || o.gain > top.gain ? o : top), null);
    const approve = best !== null && !this.input.requireApproval;
    for (const outcome of outcomes) {
      const chosen = approve && outcome === best;
      const why = outcome.accepted && !chosen && approve ? 'accepted, not chosen: the other candidate improved more'
        : chosen ? 'auto-approved' : null;
      const note = [outcome.record.note, why].filter(Boolean).join('; ');
      this.emit({ ...outcome.record, approved: chosen, ...(note ? { note } : {}) });
    }
    if (best === null) return { stop: 'not_accepted' }; // the caller escalates the hero and carries on
    if (!approve) return { stop: 'awaiting_approval' };
    return { head: { hash: best.record.dataHash, data: best.data }, scope: flagged };
  }

  /** One all-matchups run on the last accepted hash, compared with the first scan. */
  async finalCheck(head) {
    const { input } = this;
    if (head.hash === input.fromHash && this.firstScan) return { report: this.firstScan, regression: [] };
    const seeds = input.seedsFor(1, 'scan'); // like round 1, so the two scans compare like with like
    const results = await this.batch(input.rounds + 1, 'final_check', head.hash, input.allMatchups, seeds);
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
    return { records: run.records, stoppedBecause: reason, finalCheck: null, headHash: head.hash,
      diagnoses: run.diagnoses, needs_designer: run.needsDesigner, candidates: run.candidates, ...extra };
  }
  const check = await run.finalCheck(head);
  if (check.regression.length) {
    const headHash = run.rejectAccepted(head.hash, check.regression);
    return { records: run.records, stoppedBecause: 'regression', finalCheck: check.report, headHash,
      diagnoses: run.diagnoses, needs_designer: run.needsDesigner, candidates: run.candidates, ...extra };
  }
  return { records: run.records, stoppedBecause: reason, finalCheck: check.report, headHash: head.hash,
    diagnoses: run.diagnoses, needs_designer: run.needsDesigner, candidates: run.candidates, ...extra };
}

export async function runAuto(input: any = {}): Promise<any> {
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
    return { records: run.records, stoppedBecause: 'error', finalCheck: null, headHash: settings.fromHash,
      diagnoses: run.diagnoses, needs_designer: run.needsDesigner, candidates: run.candidates, error };
  }
}
