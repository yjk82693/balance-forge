import type { RunPhase } from "../lib/progress";
import { MiniArenas } from "./MiniArenas";

interface Props {
  phase?: RunPhase;
  busy: boolean;
  done: number;
  total: number;
  /** holdout counter, shown beside the baseline's once that phase starts */
  holdout?: { done: number; total: number };
  /** hero diagnosis counter, shown the same way */
  diagnose?: { done: number; total: number };
  /** seconds since the run started; keeps the panel moving while the server is quiet */
  elapsed?: number;
}

const n = (x: number) => x.toLocaleString("en-US");

/** Name of the running phase, for the live counter. */
export const phaseName = (phase?: RunPhase) =>
  phase === "holdout"
    ? "Holdout on the patched data"
    : phase === "diagnose"
      ? "Diagnosing heroes"
      : phase === "baseline"
        ? "Baseline"
        : "";

function statusLine(busy: boolean, done: number, total: number, elapsed = 0): string {
  const clock = elapsed > 0 ? ` · ${elapsed} s` : "";
  if (busy) return total ? `${n(done)} of ${n(total)} matches${clock}` : `Getting the bots ready…${clock}`;
  return done ? `${n(done)} matches played` : "Press Run to watch the bots play.";
}

/** Progress bar plus the mini-arena texture grid. The big counter lives in the report panel. */
/** A second progress bar for a later phase of the run, shown under the baseline's finished one. */
function PhaseBar({ label, what, counter }: { label: string; what: string; counter: { done: number; total: number } }) {
  const pctDone = counter.total ? Math.round((counter.done / counter.total) * 100) : 0;
  return (
    <>
      <div
        className="progress holdout"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={counter.total || 100}
        aria-valuenow={counter.done}
        aria-label={what}
      >
        <span style={{ width: `${pctDone}%` }} />
      </div>
      <p className="small live-line">
        {label} · {n(counter.done)} of {counter.total ? n(counter.total) : "…"} matches
      </p>
    </>
  );
}

export function LivePanel({ busy, done, total, phase, elapsed, holdout, diagnose }: Props) {
  const pctDone = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="panel live" aria-labelledby="live-title">
      <div className="live-text">
        <div className="panel-head">
          <span id="live-title" className="eyebrow">
            Live batch
          </span>
        </div>
        <div
          className={`progress${busy && !total ? " waiting" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total || 100}
          aria-valuenow={done}
          aria-label="Bot matches played"
        >
          <span style={{ width: `${pctDone}%` }} />
        </div>
        <p className="small live-line">{phaseName(phase) && busy ? `${phaseName(phase)} · ` : ""}
          {statusLine(busy, done, total, elapsed)}</p>
        {holdout && <PhaseBar label="Holdout" what="Holdout matches played" counter={holdout} />}
        {diagnose && <PhaseBar label="Diagnosing heroes" what="Diagnosis matches played" counter={diagnose} />}
        <p className="caption">Each bar settles as its games pile up.</p>
      </div>
      {busy && <MiniArenas active />}
    </section>
  );
}
