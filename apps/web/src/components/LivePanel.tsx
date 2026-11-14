import { MiniArenas } from "./MiniArenas";

interface Props {
  busy: boolean;
  done: number;
  total: number;
}

const n = (x: number) => x.toLocaleString("en-US");

function statusLine(busy: boolean, done: number, total: number): string {
  if (busy) return `${n(done)} of ${n(total)} matches`;
  return done ? `${n(done)} matches played` : "Press Run to watch the bots play.";
}

/** Progress bar plus the mini-arena texture grid. The big counter lives in the report panel. */
export function LivePanel({ busy, done, total }: Props) {
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
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total || 100}
          aria-valuenow={done}
          aria-label="Bot matches played"
        >
          <span style={{ width: `${pctDone}%` }} />
        </div>
        <p className="small live-line">{statusLine(busy, done, total)}</p>
        <p className="caption">Each bar settles as its games pile up.</p>
      </div>
      <MiniArenas active={busy} />
    </section>
  );
}
