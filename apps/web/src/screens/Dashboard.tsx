import { useEffect, useMemo, useState } from "react";
import { CompareReplay } from "../components/CompareReplay";
import { FitStage } from "../components/FitStage";
import { LivePanel } from "../components/LivePanel";
import { MatchesTable, type MatchRow } from "../components/MatchesTable";
import { ReportPanel } from "../components/ReportPanel";
import { ResultCard } from "../components/ResultCard";
import { MatchupPicker } from "../components/MatchupPicker";
import { RunTable } from "../components/RunTable";
import { TopBar } from "../components/TopBar";
import { VersionToggle } from "../components/VersionToggle";
import { rowStats } from "../components/WinRateChart";
import { botRows } from "../lib/groups";
import { useManifest } from "../lib/assets";
import {
  SAMPLE_HUMAN_ID,
  pickTargetDimension,
  readTheme,
  sampleRows,
  saveTheme,
  type Theme,
} from "../lib/dashboardData";
import { useDemoVersion } from "../lib/demo";
import { fixtureMatchConfig } from "../lib/fixtures";
import { loadJustPlayed } from "../lib/justPlayed";
import { currentDiagnose, currentMatchup, saveChosen, saveDiagnose, type Matchup } from "../lib/matchup";
import { loadRecordedRun } from "../lib/recorded";
import { buildFacts } from "../lib/resultCard";
import { useReplaySource } from "../lib/replaySource";
import { useRunner } from "../lib/useRunner";
import type { PlaytestRun } from "../lib/api";
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
  const { run, busy, live, error, notice, elapsed, start } = useRunner();
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

  // The all-matchups table and "other findings" come from the stored roster run, never from the live one.
  const [roster, setRoster] = useState<PlaytestRun | null>(null);
  useEffect(() => {
    loadRecordedRun().then(setRoster, () => setRoster(null));
  }, []);
  // The matchup to run: a person's pick, else the match just played, else the recorded roster's largest outlier.
  const [picked, setPicked] = useState<Matchup | null>(null);
  const matchup = useMemo(() => picked ?? currentMatchup(played, roster), [picked, played, roster]);
  const choose = (m: Matchup) => {
    saveChosen(m);
    setPicked(m);
  };
  const [diagnoseChoice, setDiagnoseChoice] = useState<boolean | null>(null);
  const diagnose = diagnoseChoice ?? currentDiagnose(matchup, roster);
  const facts = useMemo(() => (run ? buildFacts(run, roster) : null), [run, roster]);

  const canPatch = !!run?.patched;
  const showPatched = canPatch && version === "patched";
  const replaySource = useReplaySource(run);
  const baseStats = run ? botRows(run.baseline.rows).map(rowStats) : [];
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
          <a className="btn secondary" href="#/versions">
            Versions
          </a>
          <VersionToggle disabled={!!run && !canPatch} hint="This run has no patched data to switch to." />
          <MatchupPicker
            value={matchup}
            onChange={choose}
            disabled={busy || mock}
            title={mock ? "Sample data: the matchup is fixed." : undefined}
          />
          <label
            className="small toggle"
            title={mock ? "Sample data: no diagnosis." : "Profile each hero against every opponent and suggest a change."}
          >
            <input
              type="checkbox"
              checked={diagnose && !mock}
              disabled={busy || mock}
              onChange={(e) => {
                saveDiagnose(e.target.checked);
                setDiagnoseChoice(e.target.checked);
              }}
            />{" "}
            Diagnose heroes
          </label>
          <button
            className="btn primary"
            onClick={() => start(matchup, diagnose)}
            aria-busy={busy}
            aria-disabled={busy}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "Bots are playing…" : "Let the bots play"}
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
            {facts && !busy ? (
              <ResultCard facts={facts} />
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
              source={replaySource}
            />
            <LivePanel
              busy={busy}
              done={live.done}
              total={live.total}
              phase={live.phase}
              elapsed={elapsed}
              holdout={live.holdout}
              diagnose={live.diagnose}
            />
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
              roster={roster}
              notice={notice}
              elapsed={elapsed}
              showPatched={showPatched}
              onRun={() => start(matchup, diagnose)}
            />
          </div>
        </main>
      </div>
    </FitStage>
  );
}
