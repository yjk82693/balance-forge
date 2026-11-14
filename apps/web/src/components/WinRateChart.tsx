import type { ReportRow } from "../lib/contract";
import { humanLabel, isHumanDimension } from "../lib/groups";
import { heroName } from "../lib/heroes";
import { targetFor, type Target } from "../lib/intent";
import { pct, wilson } from "../lib/stats";
import { HeroPortrait } from "./HeroPortrait";

export const MIN_GAMES = 30; // below this: hatched bar, no outlier alarm
export const BAND: [number, number] = [0.45, 0.55];

export interface Matchup {
  a: string;
  b: string;
  /** a human match: a and b are not heroes, only the label is meaningful */
  human: boolean;
}
export function parseMatchup(dimension: string): Matchup {
  if (isHumanDimension(dimension)) return { a: humanLabel(dimension), b: "", human: true };
  const [a, b] = dimension.split(" vs ");
  return { a: a ?? dimension, b: b ?? "", human: false };
}

export interface RowStats {
  row: ReportRow;
  rate: number;
  lo: number;
  hi: number;
  small: boolean;
  outlier: boolean;
  matchup: Matchup;
  /** what the designer intends for this matchup (even unless the intent says otherwise) */
  target: Target;
}

/**
 * Wilson interval from wins/games; outlier = interval entirely outside the intended band (the target ±5 points, 45–55%
 * when the matchup is meant to be even), never for tiny n.
 */
export function rowStats(row: ReportRow): RowStats {
  const [lo, hi] = wilson(row.wins, row.games);
  const small = row.games < MIN_GAMES;
  const human = isHumanDimension(row.dimension);
  // Human rows are descriptive: a handful of games never raises an outlier alarm.
  const matchup = parseMatchup(row.dimension);
  const target = human ? targetFor("", "") : targetFor(matchup.a, matchup.b);
  const outlier = !human && !small && (lo > target.band[1] || hi < target.band[0]);
  return {
    row,
    rate: row.games ? row.wins / row.games : 0,
    lo,
    hi,
    small,
    outlier,
    matchup,
    target,
  };
}

export const ciText = (s: RowStats) =>
  `95% CI ${pct(s.lo)}–${pct(s.hi)}% · n = ${s.row.games.toLocaleString("en-US")}`;

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

/** The 0-100% track with the fair band (the intended result ±5; 45–55% unless the designer wants otherwise). */
export function Plot({ children, band = BAND }: { children: React.ReactNode; band?: [number, number] }) {
  return (
    <div className="viz-plot">
      <div className="viz-band" style={{ left: `${band[0] * 100}%`, width: `${(band[1] - band[0]) * 100}%` }} />
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

function RowLabel({ s, dense }: { s: RowStats; dense: boolean }) {
  if (s.matchup.human) {
    return (
      <>
        <span className="badge human">human</span>
        <span className="small viz-name">{s.matchup.a}</span>
      </>
    );
  }
  return (
    <>
      <HeroPortrait hero={s.matchup.a} size={dense ? 20 : 32} />
      <span className="small viz-name">
        {heroName(s.matchup.a)} <span className="text-2">vs</span> {heroName(s.matchup.b)}
      </span>
    </>
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
            <RowLabel s={s} dense={dense} />
            {s.outlier && <span className="badge outlier">▲ Outlier</span>}
            {s.target.favored && <span className="caption intended">{s.target.label}</span>}
          </div>
          <Plot band={s.target.band}>
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
        Dashed line = 50%. Shaded band = the intended result ±5 (45–55% where even). Whiskers = 95% CI (Wilson).
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
