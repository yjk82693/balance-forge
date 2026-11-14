import type { PlaytestRun } from "./api";
import { rowStats } from "../components/WinRateChart";
import { describePath } from "../components/PatchCompare";
import { VERDICT_COPY, fmtSeconds, n, outliersFirst, pickTargetDimension } from "./dashboardData";
import { originLabel } from "./fullRun";
import { botRows } from "./groups";
import { heroName } from "./heroes";
import { pct } from "./stats";
import type { VerdictKind } from "./api";

/** A win rate with its 95% interval and the games behind it. */
export interface Rate {
  matchup: string;
  rate: number;
  lo: number;
  hi: number;
  games: number;
}

export interface Finding extends Rate {
  /** who the rate is for, so "weak" reads right: the first hero named */
  side: string;
}

export interface PatchFact {
  field: string;
  old?: number;
  next: number;
  rationale: string;
  origin: string;
  valid: boolean;
  errors: string[];
}

/** Everything the Result card shows and Copy summary writes. Built only from the run and the recorded report. */
export interface ResultFacts {
  /** where the run's numbers come from: "live run", "recorded" or "sample data" */
  source: "live run" | "recorded" | "sample data";
  sourceDetail: string;
  outlier: (Rate & { isOutlier: boolean }) | null;
  patch: PatchFact[];
  holdout: Rate | null;
  verdict: { kind: VerdictKind; label: string; reasons: string[] } | null;
  /** other matchups from the recorded roster report that sit clearly away from 50% */
  others: Finding[];
  /** set when the roster report exists but nothing in it can be called an outlier, and why */
  othersNote: string | null;
}

const name = (dimension: string) => dimension.split(" vs ").map(heroName).join(" vs ");

function rateOf(dimension: string, rows: Parameters<typeof botRows>[0]): Rate | null {
  const row = botRows(rows).find((r) => r.dimension === dimension);
  if (!row) return null;
  const s = rowStats(row);
  return { matchup: name(dimension), rate: s.rate, lo: s.lo, hi: s.hi, games: row.games };
}

/** The matchups of the recorded roster report that are clearly unbalanced, most lopsided first. */
type Findings = Pick<ResultFacts, "others" | "othersNote">;

function findingsFrom(roster: PlaytestRun | null, skip: string | undefined): Findings {
  if (!roster) return { others: [], othersNote: null };
  const stats = botRows(roster.baseline.rows).map(rowStats).filter((s) => s.row.dimension !== skip);
  const others = outliersFirst(stats.filter((s) => s.outlier)).slice(0, 3).map((s) => ({
    matchup: name(s.row.dimension),
    side: heroName(s.matchup.a),
    rate: s.rate,
    lo: s.lo,
    hi: s.hi,
    games: s.row.games,
  }));
  if (others.length || stats.length === 0) return { others, othersNote: null };
  const most = Math.max(...stats.map((s) => s.row.games));
  const note = most < 30
    ? `No matchup can be judged yet: at most ${n(most)} games per matchup, and an outlier needs 30.`
    : "No other matchup is clearly away from 50%.";
  return { others, othersNote: note };
}

function sourceOf(run: PlaytestRun): Pick<ResultFacts, "source" | "sourceDetail"> {
  const b = run.baseline;
  const detail = [`${n(b.validMatches)} matches`, b.elapsedMs != null ? fmtSeconds(b.elapsedMs) : ""].filter(Boolean);
  const source = run.sample ? "sample data" : b.recorded ? "recorded" : "live run";
  return { source, sourceDetail: detail.join(" · ") };
}

export function buildFacts(run: PlaytestRun, roster: PlaytestRun | null): ResultFacts {
  const stats = botRows(run.baseline.rows).map(rowStats);
  const target = stats.find((s) => s.row.dimension === pickTargetDimension(stats));
  const changes =
    run.proposal?.changes ??
    run.proposal?.patch.replacements.map((r) => ({ path: r.path, label: undefined, old: undefined, new: r.value })) ??
    [];
  const lead = target ? rateOf(target.row.dimension, run.baseline.rows) : null;
  return {
    ...sourceOf(run),
    outlier: lead ? { ...lead, isOutlier: !!target?.outlier } : null,
    patch: run.proposal
      ? changes.slice(0, 3).map((c) => ({
          field: c.label ?? describePath(c.path),
          old: c.old,
          next: c.new,
          rationale: run.proposal!.patch.rationale,
          origin: originLabel(run.proposal!.origin),
          valid: run.proposal!.validation.ok,
          errors: run.proposal!.validation.errors,
        }))
      : [],
    holdout: target && run.patched ? rateOf(target.row.dimension, run.patched.rows) : null,
    verdict: run.verdict
      ? { kind: run.verdict.verdict, label: VERDICT_COPY[run.verdict.verdict].label, reasons: run.verdict.reasons }
      : null,
    ...findingsFrom(roster, target?.row.dimension),
  };
}

const rateText = (r: Rate) => `${pct(r.rate)}% (95% CI ${pct(r.lo)}–${pct(r.hi)}%), ${n(r.games)} games`;

/** The card as plain text, for pasting into a chat or a slide. Same facts, nothing added. */
export function summaryText(f: ResultFacts): string {
  const lines = ["Balance check: Hero Arena", `Source: ${f.source}${f.sourceDetail ? ` · ${f.sourceDetail}` : ""}`];
  if (f.source === "sample data") lines.push("These are sample numbers, not a real run.");
  if (f.outlier) {
    const verb = f.outlier.isOutlier ? "Outlier" : "Most lopsided matchup (within the normal range)";
    lines.push(`${verb}: ${f.outlier.matchup}, first hero wins ${rateText(f.outlier)}`);
  } else lines.push("Outlier: none, too few games per matchup.");
  for (const p of f.patch) {
    const change = `${p.field} ${p.old ?? "?"} -> ${p.next}`;
    lines.push(`Patch (${p.origin}): ${change}. ${p.rationale}`.trim());
    lines.push(`Validation: ${p.valid ? "passed" : `failed${p.errors.length ? ` (${p.errors.join("; ")})` : ""}`}`);
  }
  if (f.holdout) {
    lines.push(`Holdout on the patched data: ${f.holdout.matchup}, first hero wins ${rateText(f.holdout)}`);
  }
  if (f.verdict) {
    const why = f.verdict.reasons.length ? `. ${f.verdict.reasons.join(" ")}` : "";
    lines.push(`Verdict: ${f.verdict.label}${why}`);
  }
  if (f.others.length) {
    lines.push("Other findings (recorded roster report):");
    for (const o of f.others) lines.push(`- ${o.matchup}: ${o.side} wins ${rateText(o)}`);
  } else if (f.othersNote) lines.push(`Other findings (recorded roster report): ${f.othersNote}`);
  return lines.join("\n");
}
