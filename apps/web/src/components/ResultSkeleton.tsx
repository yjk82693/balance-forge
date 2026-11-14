import { n } from "../lib/dashboardData";
import { isIndeterminate, shownPhase } from "../lib/runPhase";
import type { LiveState } from "../lib/useRunner";

/** The phase in words, as the person running it would say it. */
export function phaseWords(phase: LiveState["phase"]): string {
  switch (phase) {
    case "baseline":
      return "Measuring baseline";
    case "diagnose":
      return "Diagnosing heroes";
    case "probe":
      return "Probing card levers (cost and power ±1 for each card)";
    case "holdout":
      return "Testing the patch on fresh seeds";
    default:
      return "Starting the run";
  }
}

/** Matches done of total for the phase that is running. */
function counterFor(live: LiveState): { done: number; total: number } {
  if ((live.phase === "diagnose" || live.phase === "probe") && live.diagnose) return live.diagnose;
  if (live.phase === "holdout" && live.holdout) return live.holdout;
  return { done: live.done, total: live.total };
}

const fmtElapsed = (s: number) =>
  s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;

/**
 * Stands in for the Result card while a long run goes on (30 to 60 s with diagnosis): the card's shape in shimmering
 * blocks, the phase in words, matches done of total with a bar, and the elapsed time. Never an empty area.
 */
interface SkeletonProps {
  live: LiveState;
  elapsed: number;
  /** Hero Cards: the quiet card probe after the baseline is shown as its own phase */
  cards?: boolean;
}

export function ResultSkeleton({ live, elapsed, cards = false }: SkeletonProps) {
  const { done, total } = counterFor(live);
  const wait = isIndeterminate(live, cards);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="panel result skeleton-card" aria-busy="true" aria-live="polite" aria-label="Run in progress">
      <div className="panel-head">
        <span className="eyebrow">Result</span>
        <span className="badge">running</span>
        <span className="spacer" />
        <span className="small">{fmtElapsed(elapsed)}</span>
      </div>
      <p className="h3 phase-words">{phaseWords(shownPhase(live, cards))}…</p>
      <div
        className={`progress${wait ? " waiting" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total || 100}
        aria-valuenow={wait ? undefined : done}
      >
        <span style={wait ? undefined : { width: `${pct}%` }} />
      </div>
      <p className="small">
        {wait
          ? `${fmtElapsed(elapsed)} so far`
          : total
            ? `${n(done)} of ${n(total)} matches`
            : "Getting the bots ready…"}
      </p>
      <div className="result-grid sk-grid" aria-hidden="true">
        {["Outlier", "AI patch", "Holdout on the patched data", "Other findings"].map((label) => (
          <div key={label}>
            <p className="caption">{label}</p>
            <div className="sk-line wide" />
            <div className="sk-line" />
            <div className="sk-line short" />
          </div>
        ))}
      </div>
    </section>
  );
}
