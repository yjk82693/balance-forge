import type { PatchProposal, Report, ReportRow } from "./contract";
import type {
  Change,
  Classification,
  Diagnosis,
  HeroProfileData,
  HeroStrength,
  OpponentRate,
  Recommendation,
  EvidenceRow,
  EvidenceSide,
  PatchOrigin,
  PlaytestRun,
  Proposal,
  ReplayInfo,
  RunEvidence,
  VerdictKind,
  VerdictRate,
  VerdictTarget,
} from "./api";
import { parseTimeline } from "./replaySource";

const ORIGINS: PatchOrigin[] = ["gemini", "grok", "fallback", "fake", "manual"];
const VERDICTS: VerdictKind[] = ["accepted", "rejected", "inconclusive"];

/** Text for the origin badge. `fake` is the offline adapter, which is not a real model's answer. */
export function originLabel(origin: PatchOrigin): string {
  return origin === "fake" ? "offline sample" : origin;
}

export const originHint = (origin: PatchOrigin): string =>
  origin === "fake"
    ? "Proposed by the offline adapter (no model was called)."
    : origin === "fallback"
      ? "The model's answer was not usable, so a built-in rule proposed this."
      : origin === "manual"
        ? "Entered by hand."
        : `Proposed by ${origin}.`;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function cleanRow(r: unknown): ReportRow | null {
  if (!isObject(r) || typeof r.dimension !== "string") return null;
  const wins = Number(r.wins);
  const games = Number(r.games);
  if (!Number.isFinite(wins) || !Number.isFinite(games) || games < 0 || wins < 0 || wins > games) return null;
  const seatWins = Number.isFinite(Number(r.seatWins)) && r.seatWins != null ? Number(r.seatWins) : undefined;
  const ci = Array.isArray(r.ci95) && r.ci95.length === 2 ? (r.ci95 as [number, number]) : ([0, 1] as [number, number]);
  return {
    dimension: r.dimension,
    wins,
    games,
    winRate: games ? wins / games : 0,
    ci95: ci,
    uses: Number(r.uses) || 0,
    opportunities: Number(r.opportunities) || 0,
    outlier: r.outlier === true,
    ...(seatWins !== undefined ? { seatWins } : {}),
    ...(Number.isFinite(Number(r.target)) && r.target != null ? { target: Number(r.target) } : {}),
    ...(Number.isFinite(Number(r.deltaToTarget)) && r.deltaToTarget != null
      ? { deltaToTarget: Number(r.deltaToTarget) }
      : {}),
  };
}

/** A Report from the wire: bad rows are dropped, missing counters get neutral defaults. Null if there are no rows. */
export function cleanReportJson(raw: unknown, defaults: Partial<Report> = {}): Report | null {
  if (!isObject(raw) || !Array.isArray(raw.rows)) return null;
  const rows = raw.rows.map(cleanRow).filter((r): r is ReportRow => r !== null);
  const valid = Number(raw.validMatches);
  return {
    reportId: String(raw.reportId ?? defaults.reportId ?? "run"),
    gameId: String(raw.gameId ?? defaults.gameId ?? "hero_arena"),
    simVersion: String(raw.simVersion ?? defaults.simVersion ?? "unknown"),
    dataHash: String(raw.dataHash ?? defaults.dataHash ?? ""),
    botPolicyVersion: String(raw.botPolicyVersion ?? defaults.botPolicyVersion ?? "unknown"),
    seedSetId: String(raw.seedSetId ?? defaults.seedSetId ?? "unknown"),
    validMatches: Number.isFinite(valid) ? valid : rows.reduce((n, r) => n + r.games, 0),
    invalidMatches: Number(raw.invalidMatches) || 0,
    draws: Number(raw.draws) || 0,
    rows,
    elapsedMs: Number.isFinite(Number(raw.elapsedMs)) ? Number(raw.elapsedMs) : defaults.elapsedMs,
    recorded: typeof raw.recorded === "boolean" ? raw.recorded : defaults.recorded,
    humanMatches: Number.isFinite(Number(raw.humanMatches)) ? Number(raw.humanMatches) : defaults.humanMatches,
  };
}

function proposalFrom(raw: unknown, validation: unknown): Proposal | undefined {
  if (!isObject(raw)) return undefined;
  const replacements = Array.isArray(raw.replacements) ? raw.replacements : [];
  const patch = {
    baseDataHash: String(raw.baseDataHash ?? ""),
    replacements,
    rationale: String(raw.rationale ?? ""),
  } as PatchProposal;
  const changes = Array.isArray(raw.changes)
    ? (raw.changes.filter((c) => isObject(c) && typeof c.path === "string") as unknown as Change[])
    : undefined;
  const v = isObject(validation) ? validation : {};
  const errors = Array.isArray(v.errors) ? v.errors.map(String) : [];
  return {
    patch,
    changes,
    origin: ORIGINS.includes(raw.origin as PatchOrigin) ? (raw.origin as PatchOrigin) : "manual",
    ...(typeof raw.fallbackReason === "string" && raw.fallbackReason ? { fallbackReason: raw.fallbackReason } : {}),
    validation: { ok: v.ok !== false && errors.length === 0, errors },
  };
}

const CLASSIFICATIONS = ["overall_strong", "overall_weak", "counter_specific"];

function opponentRate(raw: unknown): OpponentRate | null {
  const rate = verdictRate(raw);
  return rate && isObject(raw) && typeof raw.opponent === "string" ? { ...rate, opponent: raw.opponent } : null;
}

function strengthFrom(raw: unknown): HeroStrength | undefined {
  if (!isObject(raw) || (raw.role !== "winner" && raw.role !== "loser")) return undefined;
  return {
    role: raw.role,
    overallRate: num(raw.overallRate),
    marginPts: num(raw.marginPts),
    opponentsOutsideBand: num(raw.opponentsOutsideBand),
    worstOpponent: typeof raw.worstOpponent === "string" ? raw.worstOpponent : undefined,
  };
}

function recommendationFrom(raw: unknown): Recommendation | null {
  if (!isObject(raw) || typeof raw.hero !== "string" || typeof raw.path !== "string") return null;
  const sizePct = num(raw.sizePct);
  if (sizePct === undefined) return null;
  const direction = /up|increase|buff|raise/i.test(String(raw.direction)) ? "up" : "down";
  const given = raw.expected;
  const expected = typeof given === "string" || typeof given === "number" ? String(given) : undefined;
  const role = raw.role === "winner" || raw.role === "loser" ? raw.role : undefined;
  const listed = Array.isArray(raw.alsoAffects) ? raw.alsoAffects : [];
  const also = listed.filter((h): h is string => typeof h === "string");
  const alsoAffects = also.length ? also : undefined;
  const why = String(raw.why ?? "");
  return { hero: raw.hero, role, path: raw.path, direction, sizePct, why, expected, alsoAffects };
}

/**
 * `diagnosis` of the run body. Heroes without a name are dropped; a missing `overall`, `strength` or recommendation
 * is fine. A single `recommendation` is read as a list of one. Null when no hero profile is usable.
 */
export function diagnosisFrom(raw: unknown): Diagnosis | null {
  if (!isObject(raw) || !Array.isArray(raw.heroes)) return null;
  const heroes: HeroProfileData[] = raw.heroes.flatMap((h) =>
    isObject(h) && typeof h.hero === "string"
      ? [{
          hero: h.hero,
          overall: verdictRate(h.overall),
          opponents: (Array.isArray(h.opponents) ? h.opponents : []).flatMap((o) => opponentRate(o) ?? []),
          strength: strengthFrom(h.strength),
        }]
      : [],
  );
  if (!heroes.length) return null;
  const single = raw.recommendation ? [raw.recommendation] : [];
  const listed = Array.isArray(raw.recommendations) ? raw.recommendations : single;
  return {
    focusHero: typeof raw.focusHero === "string" ? raw.focusHero : undefined,
    heroes,
    classification: CLASSIFICATIONS.includes(String(raw.classification))
      ? (raw.classification as Classification)
      : undefined,
    recommendations: listed.flatMap((r) => recommendationFrom(r) ?? []),
  };
}

const OUTCOMES = ["improved", "unchanged", "worse"];

function verdictRate(raw: unknown): VerdictRate | null {
  if (!isObject(raw) || !Number.isFinite(raw.rate) || !Number.isFinite(raw.games)) return null;
  const ci = Array.isArray(raw.ci95) && raw.ci95.length === 2 ? (raw.ci95 as [number, number]) : [raw.rate, raw.rate];
  return { rate: Number(raw.rate), ci95: [Number(ci[0]), Number(ci[1])], games: Number(raw.games) };
}

/** `verdict.targets`: one row per target matchup; incomplete rows are dropped, and none left gives undefined. */
export function targetsFrom(raw: unknown): VerdictTarget[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: VerdictTarget[] = [];
  for (const t of raw) {
    if (!isObject(t) || typeof t.matchup !== "string" || !OUTCOMES.includes(String(t.outcome))) continue;
    const before = verdictRate(t.before);
    const after = verdictRate(t.after);
    const outcome = t.outcome as VerdictTarget["outcome"];
    if (before && after) rows.push({ matchup: t.matchup, before, after, outcome });
  }
  return rows.length ? rows : undefined;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function evidenceSide(raw: unknown): EvidenceSide | null {
  if (!isObject(raw) || typeof raw.hero !== "string") return null;
  const actions = Array.isArray(raw.actions) ? raw.actions : [];
  return {
    hero: raw.hero,
    damage: num(raw.damage),
    damageShare: num(raw.damageShare),
    actions: actions
      .filter((a): a is Record<string, unknown> => isObject(a) && typeof a.actionId === "string")
      .map((a) => ({
        actionId: String(a.actionId),
        opportunities: num(a.opportunities),
        uses: num(a.uses),
        useRate: num(a.useRate),
      })),
  };
}

/**
 * `evidence` of the run body: `{ missing: [...], rows: [{ dimension, games, focal: Side, other: Side }] }`.
 * Rows without both sides are dropped; null numbers stay absent. Null when there is no usable evidence.
 */
export function evidenceFrom(raw: unknown): RunEvidence | null {
  if (!isObject(raw) || !Array.isArray(raw.rows)) return null;
  const rows: EvidenceRow[] = [];
  for (const r of raw.rows) {
    if (!isObject(r) || typeof r.dimension !== "string") continue;
    const focal = evidenceSide(r.focal);
    const other = evidenceSide(r.other);
    if (focal && other) rows.push({ dimension: r.dimension, games: num(r.games), focal, other });
  }
  const missing = Array.isArray(raw.missing) ? raw.missing.map(String) : [];
  return rows.length ? { rows, missing } : null;
}

/** Optional `replay` in the response: the match to replay and, if the analysis gave one, its HP timeline. */
function replayFrom(raw: unknown): ReplayInfo | undefined {
  if (!isObject(raw) || typeof raw.matchId !== "string") return undefined;
  const timeline = parseTimeline(raw) ?? undefined;
  return { matchId: raw.matchId, seed: Number.isInteger(raw.seed) ? (raw.seed as number) : undefined, timeline };
}

/**
 * The response of POST /v1/playtest/full (and the recorded roster file, if it has the same shape) as a PlaytestRun.
 * Only `baseline` is required; proposal, patched report and verdict show when they are there.
 * A file that is a bare Report (rows at the top level) is accepted as a baseline-only run.
 */
export function runFromFull(raw: unknown): PlaytestRun | null {
  if (!isObject(raw)) return null;
  const top: Partial<Report> = {
    reportId: typeof raw.runId === "string" ? raw.runId : undefined,
    gameId: typeof raw.gameId === "string" ? raw.gameId : undefined,
    botPolicyVersion: typeof raw.botPolicyVersion === "string" ? raw.botPolicyVersion : undefined,
    seedSetId: typeof raw.seedSetId === "string" ? raw.seedSetId : undefined,
    elapsedMs: Number.isFinite(Number(raw.elapsedMs)) ? Number(raw.elapsedMs) : undefined,
    humanMatches: Number.isFinite(Number(raw.humanMatches)) ? Number(raw.humanMatches) : undefined,
  };
  const baseline = cleanReportJson(raw.baseline ?? (Array.isArray(raw.rows) ? raw : null), top);
  if (!baseline) return null;
  const patched = cleanReportJson(raw.patched, {
    ...top,
    reportId: `${top.reportId ?? "run"}-patched`,
    seedSetId: typeof raw.holdoutSeedSetId === "string" ? raw.holdoutSeedSetId : top.seedSetId,
    dataHash: typeof raw.patchedDataHash === "string" ? raw.patchedDataHash : undefined,
  });
  const verdictRaw = isObject(raw.verdict) ? raw.verdict : null;
  const kind = verdictRaw?.verdict as VerdictKind | undefined;
  return {
    baseline,
    patched: patched ?? undefined,
    proposal: proposalFrom(raw.proposal, raw.validation),
    verdict:
      kind && VERDICTS.includes(kind)
        ? {
            verdict: kind,
            reasons: Array.isArray(verdictRaw?.reasons) ? verdictRaw.reasons.map(String) : [],
            targets: targetsFrom(verdictRaw?.targets),
          }
        : undefined,
    runId: top.reportId,
    fair: raw.fair === true ? true : undefined,
    diagnosis: diagnosisFrom(raw.diagnosis) ?? undefined,
    evidence: evidenceFrom(raw.evidence) ?? undefined,
    replay: replayFrom(raw.replay),
  };
}
