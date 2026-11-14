import type { ReportRow } from "../lib/contract";
import { heroName } from "../lib/heroes";
import { pct, wilson } from "../lib/stats";
import { HeroPortrait } from "./HeroPortrait";

export const MIN_GAMES = 30; // below this: hatched bar, no outlier alarm
export const BAND: [number, number] = [0.45, 0.55];

export interface Matchup {
  a: string;
  b: string;
}
export function parseMatchup(dimension: string): Matchup {
  const [a, b] = dimension.split(" vs ");
  return { a: a ?? dimension, b: b ?? "" };
}

export interface RowStats {
  row: ReportRow;
  rate: number;
  lo: number;
  hi: number;
  small: boolean;
  outlier: boolean;
  matchup: Matchup;
}

/** Wilson interval from wins/games; outlier = interval entirely outside the balanced band, never for tiny n. */
export function rowStats(row: ReportRow): RowStats {
  const [lo, hi] = wilson(row.wins, row.games);
  const small = row.games < MIN_GAMES;
  const outlier = !small && (lo > BAND[1] || hi < BAND[0]);
  return { row, rate: row.games ? row.wins / row.games : 0, lo, hi, small, outlier, matchup: parseMatchup(row.dimension) };
}

export const ciText = (s: RowStats) => `95% CI ${pct(s.lo)}–${pct(s.hi)}% · n = ${s.row.games.toLocaleString("en-US")}`;

const AXIS = [0, 25, 50, 75, 100];

export function Axis() {
  return (
    <div className="viz-axis" aria-hidden="true">
      {AXIS.map((t) => (
        <span key={t} style={{ left: `${t}%` }} className={t === 50 ? "base" : undefined}>
          {t}
          {t === 50 || t === 100 ? "%" : ""}
        </span>
      ))}
    </div>
  );
}

export function Plot({ children }: { children: React.ReactNode }) {
  return (
    <div className="viz-plot">
      <div className="viz-band" style={{ left: `${BAND[0] * 100}%`, width: `${(BAND[1] - BAND[0]) * 100}%` }} />
      {children}
      <div className="viz-baseline" />
    </div>
  );
}

export function Interval({ s }: { s: RowStats }) {
  if (s.small) return null;
  return (
    <div className="viz-ci" title={ciText(s)} style={{ left: `${s.lo * 100}%`, width: `${(s.hi - s.lo) * 100}%` }}>
      <i className="cap l" />
      <i className="cap r" />
      <i className="tick" style={{ left: `${((s.rate - s.lo) / (s.hi - s.lo || 1)) * 100}%` }} />
    </div>
  );
}

export function WinRateChart({ rows, dense = false }: { rows: ReportRow[]; dense?: boolean }) {
  const stats = rows.map(rowStats);
  return (
    <div className={`viz${dense ? " dense" : ""}`}>
      <div className="viz-row head">
        <span />
        <Axis />
        <span />
      </div>
      {stats.map((s) => (
        <div key={s.row.dimension} className={`viz-row${s.outlier ? " outlier" : ""}`}>
          <div className="viz-label">
            <HeroPortrait hero={s.matchup.a} size={dense ? 20 : 32} />
            <span className="small viz-name">
              {heroName(s.matchup.a)} <span className="text-2">vs</span> {heroName(s.matchup.b)}
            </span>
            {s.outlier && <span className="badge outlier">▲ Outlier</span>}
          </div>
          <Plot>
            <div
              className={`viz-bar${s.outlier ? " warn" : ""}${s.small ? " small-n" : ""}`}
              style={{ width: `${s.rate * 100}%` }}
            />
            <Interval s={s} />
          </Plot>
          <span className="viz-value small" title={ciText(s)}>
            {s.small ? "Too few games yet" : `${pct(s.rate)}%`}
          </span>
        </div>
      ))}
      <p className="caption viz-foot">
        Dashed line = 50%. Shaded band = 45–55%. Whiskers = 95% CI (Wilson).
      </p>
      <table className="sr-only">
        <caption>Win rate by matchup</caption>
        <thead>
          <tr>
            <th>Matchup</th>
            <th>Win rate</th>
            <th>95% CI</th>
            <th>Games</th>
            <th>Outlier</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.row.dimension}>
              <td>{s.row.dimension}</td>
              <td>{pct(s.rate)}%</td>
              <td>
                {pct(s.lo)}–{pct(s.hi)}%
              </td>
              <td>{s.row.games}</td>
              <td>{s.outlier ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
