import { useEffect, useMemo, useState } from "react";
import { CardsDashboard } from "../components/CardsDashboard";
import { TentacleDashboard } from "../components/TentacleDashboard";
import { DashboardView } from "../components/DashboardView";
import { useDashGame } from "../lib/dashGame";
import { type MatchRow } from "../components/MatchesTable";
import { rowStats } from "../components/WinRateChart";
import { botRows } from "../lib/groups";
import { useManifest } from "../lib/assets";
import { useIntent } from "../lib/intent";
import { useHeroStats } from "../lib/heroStats";
import {
  SAMPLE_HUMAN_ID,
  pickTargetDimension,
  readTheme,
  sampleRows,
  saveTheme,
  type Theme,
} from "../lib/dashboardData";
import { loadSkill, policyFor, saveSkill, type BotSkill } from "../lib/botPolicy";
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
  const game = useDashGame();
  const [theme, setTheme] = useState<Theme>(readTheme);
  // Light is for projecting this screen only; every other screen stays dark.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
    return () => {
      document.documentElement.dataset.theme = "dark";
    };
  }, [theme]);
  const onTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  if (game === "tentacle_run") return <TentacleDashboard theme={theme} onTheme={onTheme} />;
  return game === "hero_cards" ? (
    <CardsDashboard theme={theme} onTheme={onTheme} />
  ) : (
    <ArenaDashboard theme={theme} onTheme={onTheme} />
  );
}

function ArenaDashboard({ theme, onTheme }: { theme: Theme; onTheme: () => void }) {
  useManifest();
  useIntent();
  useHeroStats();
  const mock = isMockMode();
  const version = useDemoVersion();
  const { run, busy, live, error, notice, elapsed, start, replace } = useRunner();
  const [selected, setSelected] = useState(SAMPLE_HUMAN_ID);
  const played = useMemo(loadJustPlayed, []);
  const rows = useMemo(() => rowsWithJustPlayed(played), [played]);

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
  const [skill, setSkill] = useState<BotSkill>(loadSkill);
  const [diagnoseChoice, setDiagnoseChoice] = useState<boolean | null>(null);
  const diagnose = diagnoseChoice ?? currentDiagnose(matchup, roster);
  // With a hero profile on the card the screen is full: the finished live panel and the matches table make room.
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

  const go = () => start(matchup, diagnose, policyFor(skill));
  return (
    <DashboardView
      ctx={{
        mock,
        run,
        facts,
        roster,
        busy,
        live,
        elapsed,
        error,
        notice,
        matchup,
        onMatchup: choose,
        diagnose,
        onDiagnose: (on) => {
          saveDiagnose(on);
          setDiagnoseChoice(on);
        },
        skill,
        onSkill: (s) => {
          saveSkill(s);
          setSkill(s);
        },
        onRun: go,
        onReplace: replace,
        theme,
        onTheme,
        showPatched,
        canPatch,
        replay: {
          seed: run?.replay?.seed ?? fixtureMatchConfig.seed,
          matchId: run?.replay?.matchId,
          heroes: replayHeroes,
          source: replaySource,
        },
        matches: { rows, selected, onSelect: setSelected, played },
      }}
    />
  );
}
