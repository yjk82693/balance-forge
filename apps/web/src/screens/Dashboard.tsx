import { useEffect, useMemo, useState } from "react";
import { CompareReplay } from "../components/CompareReplay";
import { DiffCard } from "../components/DiffCard";
import { FitStage } from "../components/FitStage";
import { LivePanel } from "../components/LivePanel";
import { MatchesTable, type MatchRow } from "../components/MatchesTable";
import { ReportPanel } from "../components/ReportPanel";
import { RunTable } from "../components/RunTable";
import { TopBar } from "../components/TopBar";
import { VersionToggle } from "../components/VersionToggle";
import { rowStats } from "../components/WinRateChart";
import { useManifest } from "../lib/assets";
import {
  MATCHES,
  SAMPLE_HUMAN_ID,
  n,
  pickTargetDimension,
  readTheme,
  sampleRows,
  saveTheme,
  type Theme,
} from "../lib/dashboardData";
import { useDemoVersion } from "../lib/demo";
import { fixtureMatchConfig } from "../lib/fixtures";
import { loadJustPlayed } from "../lib/justPlayed";
import { useRunner } from "../lib/useRunner";
import { isMockMode } from "../mock/types";

/** Sample rows with the match the viewer just played pinned on top (replacing the fixture human row). */
function rowsWithJustPlayed(played: ReturnType<typeof loadJustPlayed>): MatchRow[] {
  if (!played) return sampleRows;
  const mine: MatchRow = {
    result: played.result,
    human: true,
    heroes: played.heroes,
    names: played.names,
    justPlayed: true,
  };
  return [mine, ...sampleRows.filter((r) => r.result.matchId !== played.result.matchId)];
}

export function Dashboard() {
  useManifest();
  const mock = isMockMode();
  const version = useDemoVersion();
  const { run, busy, live, error, notice, start } = useRunner();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [selected, setSelected] = useState(SAMPLE_HUMAN_ID);
  const played = useMemo(loadJustPlayed, []);
  const rows = useMemo(() => rowsWithJustPlayed(played), [played]);

  // Light is for projecting this screen only; every other screen stays dark.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
    return () => {
      document.documentElement.dataset.theme = "dark";
    };
  }, [theme]);

  const canPatch = !!run?.patched;
  const showPatched = canPatch && version === "patched";
  const baseStats = run ? run.baseline.rows.map(rowStats) : [];
  const target = baseStats.find((s) => s.row.dimension === pickTargetDimension(baseStats));
  // Replay heroes follow the baseline's target matchup, so they stay put when the toggle flips.
  const replayHeroes: [string, string] = target
    ? [target.matchup.a, target.matchup.b || target.matchup.a]
    : ["bari", "real_armor"];

  return (
    <FitStage>
      <div className="screen dash dash-compact">
        <TopBar>
          <span className="eyebrow" style={{ color: "var(--game-arena)" }}>
            HERO ARENA
          </span>
          <span className="small text-2">
            Balance report{run ? ` · ${showPatched ? "patched" : "broken"} data` : ""}
          </span>
          <span className="spacer" />
          <VersionToggle disabled={!!run && !canPatch} hint="This run has no patched data to switch to." />
          <button className="btn primary" onClick={start} aria-busy={busy} aria-disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "Bots are playing…" : `Run ${n(MATCHES)} bot matches`}
          </button>
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
            {run?.proposal ? (
              <DiffCard proposal={run.proposal} sample={run.sample} />
            ) : (
              <section className="panel diff">
                <div className="panel-head">
                  <span className="eyebrow">Suggested patch</span>
                </div>
                <p className="small text-2">
                  {busy
                    ? "Waiting for the model's proposal…"
                    : "No patch yet. Let the bots play and a suggestion shows up here."}
                </p>
              </section>
            )}
            <CompareReplay
              seed={run?.replay?.seed ?? fixtureMatchConfig.seed}
              storedMatchId={run?.replay?.matchId}
              heroes={replayHeroes}
              active={showPatched ? "patched" : "broken"}
              sample
            />
            <LivePanel busy={busy} done={live.done} total={live.total} />
            <section className="panel matches-panel" aria-labelledby="matches-title">
              <div className="panel-head">
                <span id="matches-title" className="eyebrow">
                  Matches
                </span>
                <span className="meta">{mock ? "sample matches" : "from the last run"}</span>
              </div>
              {mock ? (
                <MatchesTable rows={rows} selected={selected} onSelect={setSelected} compact />
              ) : (
                <RunTable run={run} played={played} />
              )}
            </section>
          </div>

          <div className="dash-right">
            <ReportPanel
              run={run}
              busy={busy}
              live={live}
              error={error}
              notice={notice}
              showPatched={showPatched}
              onRun={start}
            />
          </div>
        </main>
      </div>
    </FitStage>
  );
}
