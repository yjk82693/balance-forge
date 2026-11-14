import { heroName } from "../lib/heroes";
import { targetFor } from "../lib/intent";
import { pct } from "../lib/stats";
import { useTrend, type TrendPoint } from "../lib/trend";
import { pairKey } from "../lib/intent";

const W = 640;
const H = 180;
const PAD = { l: 48, r: 16, t: 16, b: 32 };

/** The win rate of the first hero of the matchup across data versions, against the intended band. */
export function TrendChart({ a, b, points }: { a: string; b: string; points: TrendPoint[] }) {
  const shown = points.slice(-8);
  const [lo, hi] = targetFor(a, b).band;
  const span = W - PAD.l - PAD.r;
  const x = (i: number) => PAD.l + (shown.length < 2 ? span / 2 : (i / (shown.length - 1)) * span);
  const y = (r: number) => PAD.t + (1 - Math.max(0, Math.min(1, r))) * (H - PAD.t - PAD.b);
  const line = shown.map((p, i) => `${x(i)},${y(p.rate)}`).join(" ");
  return (
    <figure className="trend">
      <figcaption className="eyebrow">Win rate across versions</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${heroName(a)} win rate against ${heroName(b)} by version`}
      >
        <rect className="trend-band" x={PAD.l} y={y(hi)} width={W - PAD.l - PAD.r} height={y(lo) - y(hi)} />
        <line className="trend-mid" x1={PAD.l} x2={W - PAD.r} y1={y(0.5)} y2={y(0.5)} />
        {[0, 0.5, 1].map((t) => (
          <text key={t} className="trend-axis" x={PAD.l - 8} y={y(t) + 5} textAnchor="end">
            {pct(t)}%
          </text>
        ))}
        {shown.length > 1 && <polyline className="trend-line" points={line} />}
        {shown.map((p, i) => (
          <g key={p.dataHash}>
            <circle className="trend-dot" cx={x(i)} cy={y(p.rate)} r={6}>
              <title>{`${p.dataHash.slice(0, 8)} · ${pct(p.rate)}% · ${p.games} games`}</title>
            </circle>
            <text className="trend-label" x={x(i)} y={y(p.rate) - 12} textAnchor="middle">
              {pct(p.rate)}%
            </text>
            <text className="trend-axis" x={x(i)} y={H - 8} textAnchor="middle">
              {p.dataHash.slice(0, 6)}
            </text>
          </g>
        ))}
      </svg>
      <p className="caption">
        {heroName(a)} against {heroName(b)}, one point per data version. Shaded band = the intended result ±5.
      </p>
    </figure>
  );
}

/** The chart for the matchup, fetched when it is shown; nothing at all when the server has no series for it. */
export function TrendSection({ a, b }: { a: string; b: string }) {
  const [first, second] = [a, b].sort(); // the server names a matchup by its sorted pair; the rate is the first one's
  const points = useTrend(pairKey(a, b));
  return points ? <TrendChart a={first} b={second} points={points} /> : null;
}
