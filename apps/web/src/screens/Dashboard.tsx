import { useEffect, useMemo, useState } from "react";
import { ArenaCanvas } from "../components/ArenaCanvas";
import { MatchesTable, type MatchRow } from "../components/MatchesTable";
import { PatchCompare } from "../components/PatchCompare";
import { WinRateChart, rowStats } from "../components/WinRateChart";
import { TopBar } from "../components/TopBar";
import { useManifest } from "../lib/assets";
import { heroName } from "../lib/heroes";
import { pct } from "../lib/stats";
import {
  fixtureMatchEnded,
  fixtureMatchResults,
  fixtureObservation,
  fixturePatch,
  fixtureReportBaseline,
  fixtureReportPatched,
  fixtureRoomStatus,
} from "../lib/fixtures";
import { replayObservation } from "../mock/mockServer";
import type { Observation } from "../lib/contract";

type Theme = "dark" | "light";
const readTheme = (): Theme => {
  try {
    return localStorage.getItem("bf-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

/** Loops the Observation fixture; restarting on `key` change is how a selected row "loads" its replay. */
function useReplay(restartKey: string): Observation {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => setFrame((f) => f + 1), 100);
    return () => clearInterval(t);
  }, [restartKey]);
  return useMemo(() => replayObservation(frame, []), [frame]);
}

// The human row is the match from the WebSocket fixture; its seat names come from the room.status fixture.
const HUMAN_ID = fixtureMatchEnded.payload.result.matchId;
const HEROES_BY_SEAT = Object.fromEntries(fixtureObservation.payload.entities.map((e) => [e.id, e.hero]));
const NAMES_BY_SEAT: Record<string, string> = Object.fromEntries(fixtureRoomStatus.payload.seats.map((s) => [s.seat, s.name]));
const rows: MatchRow[] = fixtureMatchResults.map((result) => {
  const human = result.matchId === HUMAN_ID;
  return { result, human, heroes: human ? HEROES_BY_SEAT : {}, names: human ? NAMES_BY_SEAT : {} };
});

export function Dashboard() {
  useManifest();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [patched, setPatched] = useState(false);
  const [selected, setSelected] = useState(HUMAN_ID);
  const observation = useReplay(selected);

  // Light is for projecting this screen only; every other screen stays dark.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("bf-theme", theme);
    } catch {
      /* private mode: theme just won't persist */
    }
    return () => {
      document.documentElement.dataset.theme = "dark";
    };
  }, [theme]);

  const report = patched ? fixtureReportPatched : fixtureReportBaseline;
  const stats = report.rows.map(rowStats);
  const worst = stats.reduce((a, b) => (Math.abs(b.rate - 0.5) > Math.abs(a.rate - 0.5) ? b : a));
  const outlier = stats.find((s) => s.outlier);
  const before = rowStats(fixtureReportBaseline.rows.find((r) => r.dimension === worst.row.dimension)!);
  const shown = outlier ?? worst;
  const headline = outlier
    ? `${heroName(outlier.matchup.a)} wins too often against ${heroName(outlier.matchup.b)}`
    : "Within normal range";
  const valid = report.validMatches;

  return (
    <div className="screen dash">
      <TopBar>
        <span className="eyebrow" style={{ color: "var(--game-arena)" }}>
          HERO ARENA
        </span>
        <span className="small text-2">Balance report · {patched ? "after patch" : "baseline"}</span>
        <span className="spacer" />
        {patched ? (
          <button className="btn secondary" onClick={() => setPatched(false)}>
            Show baseline
          </button>
        ) : (
          <button className="btn primary" onClick={() => setPatched(true)}>
            Try the patch
          </button>
        )}
        <button
          className="btn secondary icon-btn"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-pressed={theme === "light"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          ◐
        </button>
      </TopBar>

      <main className="dash-grid">
        <div className="dash-left">
          <div className="arena-stage dash-stage">
            <ArenaCanvas observation={observation} />
            <div className="arena-overlay">
              <span className="badge">sample replay</span>
            </div>
          </div>
          <section className="panel matches-panel" aria-labelledby="matches-title">
            <div className="panel-head">
              <span id="matches-title" className="eyebrow">
                Matches
              </span>
              <span className="meta">sample matches</span>
            </div>
            <MatchesTable rows={rows} selected={selected} onSelect={setSelected} />
          </section>
        </div>

        <div className="dash-right">
          <section className="panel report" aria-labelledby="report-title">
            <div className="panel-head">
              <span id="report-title" className="eyebrow">
                Balance report
              </span>
              <span className="meta">n = {valid.toLocaleString("en-US")}</span>
            </div>
            <h1 className="h2">{headline}</h1>
            <p className="kpi">
              {pct(shown.rate)}% · {shown.row.games.toLocaleString("en-US")} games
            </p>
            <p className="report-meta">
              <span className="badge recorded">recorded · {valid.toLocaleString("en-US")} matches</span>
              <span className="badge">sample data</span>
              <span className="caption">
                {report.seedSetId} · {report.draws} draws
              </span>
            </p>
            <hr className="divider" />
            <p className="eyebrow text-2" style={{ color: "var(--text-2)" }}>
              Win rate by matchup
            </p>
            <WinRateChart rows={report.rows} />
            <hr className="divider" />
            <div className="panel-head">
              <span className="eyebrow">Suggested patch</span>
              <span className="meta">{patched ? "after" : "before"}</span>
            </div>
            <PatchCompare before={fixtureReportBaseline} after={fixtureReportPatched} patch={fixturePatch} showAfter={patched} />
            {patched && (
              <p className="result-line" role="status">
                <span className="status ok">
                  <span className="dot" />
                  Not an outlier now: {pct(before.rate)}% → {pct(shown.rate)}% · 95% CI {pct(shown.lo)}–{pct(shown.hi)}%
                </span>
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
