import type { FitnessPoint } from "../lib/botPolicy";
import { pct } from "../lib/stats";

const W = 260;
const H = 90;
const PAD = 6;

/** Generation → mean win rate as a small line chart, with the fair 50% level dashed. Nothing drawn for no data. */
export function FitnessCurve({ points, label }: { points: FitnessPoint[]; label: string }) {
  if (points.length === 0) return <p className="small text-2">No fitness curve in the file.</p>;
  const first = points[0].generation;
  const last = points[points.length - 1].generation;
  const span = Math.max(1, last - first);
  const x = (g: number) => PAD + ((g - first) / span) * (W - 2 * PAD);
  const y = (r: number) => H - PAD - Math.max(0, Math.min(1, r)) * (H - 2 * PAD);
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.generation).toFixed(1)} ${y(p.meanWinRate).toFixed(1)}`)
    .join(" ");
  const end = points[points.length - 1];
  return (
    <figure className="fitness">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${label}: mean win rate ${pct(points[0].meanWinRate)}% to ${pct(end.meanWinRate)}%`}
      >
        <line x1={PAD} x2={W - PAD} y1={y(0.5)} y2={y(0.5)} className="fitness-mid" />
        <path d={line} className="fitness-line" fill="none" />
        <circle cx={x(end.generation)} cy={y(end.meanWinRate)} r="3.5" className="fitness-dot" />
      </svg>
      <figcaption className="caption">
        generation {first}–{last} · {pct(points[0].meanWinRate)}% → {pct(end.meanWinRate)}%
      </figcaption>
    </figure>
  );
}
