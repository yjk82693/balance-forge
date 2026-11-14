import type { PatchProposal, Report, ReportRow } from "./contract";
import type { Change, PatchOrigin, PlaytestRun, Proposal, VerdictKind } from "./api";

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
    validation: { ok: v.ok !== false && errors.length === 0, errors },
  };
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
        ? { verdict: kind, reasons: Array.isArray(verdictRaw?.reasons) ? verdictRaw.reasons.map(String) : [] }
        : undefined,
    runId: top.reportId,
  };
}
