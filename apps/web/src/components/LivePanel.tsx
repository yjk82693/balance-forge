import { MiniArenas } from "./MiniArenas";

interface Props {
  phase?: "baseline" | "holdout";
  busy: boolean;
  done: number;
  total: number;
  /** seconds since the run started; keeps the panel moving while the server is quiet */
  elapsed?: number;
}

const n = (x: number) => x.toLocaleString("en-US");

/** Name of the running phase, for the live counter. */
export const phaseName = (phase?: "baseline" | "holdout") =>
  phase === "holdout" ? "Holdout on the patched data" : phase === "baseline" ? "Baseline" : "";

function statusLine(busy: boolean, done: number, total: number, elapsed = 0): string {
  const clock = elapsed > 0 ? ` · ${elapsed} s` : "";
  if (busy) return total ? `${n(done)} of ${n(total)} matches${clock}` : `Getting the bots ready…${clock}`;
  return done ? `${n(done)} matches played` : "Press Run to watch the bots play.";
}

/** Progress bar plus the mini-arena texture grid. The big counter lives in the report panel. */
export function LivePanel({ busy, done, total, phase, elapsed }: Props) {
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
        <p className="caption">Each bar settles as its games pile up.</p>
      </div>
      <MiniArenas active={busy} />
    </section>
  );
}
