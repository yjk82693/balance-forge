import type { ReactNode } from "react";
import { pct } from "../lib/stats";
import { heroName } from "../lib/heroes";
import type { ResultFacts } from "../lib/resultCard";
import { phaseWords } from "./ResultSkeleton";
import { HeroPortrait } from "./HeroPortrait";
import type { RowStats } from "./WinRateChart";
import type { LiveState } from "../lib/useRunner";

const place = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;

/** Actual win rate (dot and interval) against the intended band on one 0-100% track. */
function IntentBar({ s }: { s: RowStats }) {
  const [lo, hi] = s.target.band;
  return (
    <div className="strip-bar" role="img" aria-label={`${pct(s.rate)}%, intended ${pct(lo)} to ${pct(hi)}%`}>
      <span className="rate-band" style={{ left: place(lo), width: `${(hi - lo) * 100}%` }} />
      <span className="rate-ci" style={{ left: place(s.lo), width: `${Math.max(0, s.hi - s.lo) * 100}%` }} />
      <span className="rate-dot" style={{ left: place(s.rate) }} />
    </div>
  );
}

interface Props {
  /** the matchup the story is about, from the run's report; null before there is a run */
  shown: RowStats | undefined;
  headline: string;
  facts: ResultFacts | null;
  busy: boolean;
  live: LiveState;
  elapsed: number;
  /** the one place that says where the numbers come from */
  status: ReactNode;
  actions: ReactNode;
  /** the "Intended?" question, shown under the bar when the matchup is flagged */
  chips?: ReactNode;
  /** shown when nothing has run yet */
  empty: ReactNode;
}

/** The headline strip: matchup, actual against intended, the verdict. Always above the fold. */
export function HeadlineStrip({ shown, headline, facts, busy, live, elapsed, status, actions, chips, empty }: Props) {
  const verdict = facts?.verdict;
  const verdictClass = verdict?.kind === "accepted" ? "ok" : verdict?.kind === "rejected" ? "bad" : "warn";
  const games = (k: number) => k.toLocaleString("en-US");
  return (
    <section className="strip" aria-label="Result">
      {busy ? (
        <div className="strip-busy" aria-busy="true" aria-live="polite">
          <p className="strip-mid">{phaseWords(live.phase)}…</p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${live.total ? Math.round((live.done / live.total) * 100) : 0}%` }} />
          </div>
          <p>
            {live.total ? `${games(live.done)} of ${games(live.total)} matches · ` : ""}
            {elapsed} s
          </p>
        </div>
      ) : !shown ? (
        <div className="strip-empty">{empty}</div>
      ) : (
        <>
          <div className="strip-who">
            <p className="strip-names">
              <HeroPortrait hero={shown.matchup.a} size={48} />
              <span>
                {heroName(shown.matchup.a)} <span className="text-2">vs</span> {heroName(shown.matchup.b)}
              </span>
              <HeroPortrait hero={shown.matchup.b} size={48} />
            </p>
            <p className="strip-big">{pct(shown.rate)}%</p>
            <p>
              {heroName(shown.matchup.a)} wins · 95% CI {pct(shown.lo)}–{pct(shown.hi)}% ·{" "}
              {games(shown.row.games)} games
            </p>
          </div>
          <div className="strip-intent">
            <p className="strip-mid">{headline}</p>
            <IntentBar s={shown} />
            <p>
              {shown.target.favored ? shown.target.label : "intended: even (50%)"}
              {shown.estimated && shown.target.favored ? " · estimated" : ""}
            </p>
            {shown.outlier && chips}
          </div>
          <div className="strip-verdict">
            {verdict ? (
              <>
                <p className={`strip-badge status ${verdictClass}`}>
                  <span className="dot" />
                  {verdict.label}
                </p>
                {verdict.needsMore ? <p>{verdict.needsMore}</p> : verdict.reasons[0] && <p>{verdict.reasons[0]}</p>}
                {facts?.fallbackNote && <p className="strip-fallback">{facts.fallbackNote}</p>}
              </>
            ) : facts?.fair ? (
              <p className="strip-badge status ok">
                <span className="dot" />
                Fair: no patch needed
              </p>
            ) : (
              <p className="strip-mid text-2">No verdict in this run</p>
            )}
          </div>
        </>
      )}
      <div className="strip-side">
        {status}
        {actions}
      </div>
    </section>
  );
}
