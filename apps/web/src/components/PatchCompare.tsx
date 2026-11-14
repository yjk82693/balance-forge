import type { Report } from "../lib/contract";
import { heroName } from "../lib/heroes";
import { pct } from "../lib/stats";
import { Axis, Interval, Plot, ciText, rowStats } from "./WinRateChart";

/** "/moves/1/power" -> "Move 1 power"; "/tuning/damageScalePermille" -> "Damage scale". */
export function describePath(path: string): string {
  const m = path.match(/^\/moves\/(\d+)\/power$/);
  if (m) return `Move ${m[1]} power`;
  if (path === "/tuning/damageScalePermille") return "Damage scale (‰)";
  return path;
}

interface Props {
  before: Report;
  after: Report;
  showAfter: boolean;
}

export function PatchCompare({ before, after, showAfter }: Props) {
  const pairs = before.rows
    .map((b) => ({ b: rowStats(b), a: after.rows.find((r) => r.dimension === b.dimension) }))
    .filter((p) => p.a && (p.a.wins !== p.b.row.wins || p.a.games !== p.b.row.games))
    .map((p) => ({ b: p.b, a: rowStats(p.a!) }))
    .sort((x, y) => Math.abs(y.a.rate - y.b.rate) - Math.abs(x.a.rate - x.b.rate))
    .slice(0, 1);

  return (
    <div className="viz patch">
      <div className="viz-row head">
        <span className="caption">
          <span className="badge before">before</span> <span className="badge after">after</span>
        </span>
        <Axis />
        <span />
      </div>
      {pairs.length === 0 && <p className="small text-2">The patch didn't change any matchup.</p>}
      {pairs.map(({ b, a }) => {
        const delta = pct(a.rate) - pct(b.rate);
        return (
          <div key={b.row.dimension} className="viz-row pair">
            <div className="viz-label">
              <span className="small viz-name">
                {heroName(b.matchup.a)} <span className="text-2">vs</span> {heroName(b.matchup.b)}
              </span>
            </div>
            <Plot>
              <div className="viz-bar before-bar" title={ciText(b)} style={{ width: `${b.rate * 100}%` }} />
              <Interval s={b} />
              <div
                className={`viz-bar after-bar${showAfter ? "" : " hidden"}`}
                title={ciText(a)}
                style={{ width: showAfter ? `${a.rate * 100}%` : 0 }}
              />
              {showAfter && <Interval s={a} />}
            </Plot>
            <span className="viz-value small delta">
              {showAfter ? (
                <>
                  {pct(b.rate)}% → <span className="accent">{pct(a.rate)}%</span>
                  <br />
                  <span className="accent">
                    {delta > 0 ? "+" : "−"}
                    {Math.abs(delta)} pts
                  </span>
                </>
              ) : (
                `${pct(b.rate)}%`
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
