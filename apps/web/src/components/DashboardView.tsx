import { useMemo, useState, type ReactNode } from "react";
import type { PlaytestRun } from "../lib/api";
import type { Report, ReportRow } from "../lib/contract";
import { heroName } from "../lib/heroes";
import type { BotSkill } from "../lib/botPolicy";
import { botRows, humanRows } from "../lib/groups";
import { headlineFor, outliersFirst, pickTargetDimension } from "../lib/dashboardData";
import { loadDesigner } from "../lib/designer";
import { IS_STATIC } from "../lib/staticMode";
import type { Matchup } from "../lib/matchup";
import type { ResultFacts } from "../lib/resultCard";
import type { ReplaySource } from "../lib/replaySource";
import type { LiveState } from "../lib/useRunner";
import { BotSkillPicker } from "./BotSkillPicker";
import { Collapsible } from "./Collapsible";
import { CompareReplay } from "./CompareReplay";
import { DesignerSection } from "./DesignerCard";
import { EmptyResult } from "./EmptyResult";
import { FitStage } from "./FitStage";
import { GameSwitch } from "./GameSwitch";
import { HeadlineStrip } from "./HeadlineStrip";
import { HeroProfile } from "./HeroProfile";
import { IntendedChips } from "./IntendedChips";
import { IntentModal } from "./IntentModal";
import { MatchesTable, type MatchRow } from "./MatchesTable";
import { MatchupPicker } from "./MatchupPicker";
import { CopyButton, HoldoutColumn, OthersColumn, PatchColumn, TargetRows } from "./ResultCard";
import { ResultSkeleton } from "./ResultSkeleton";
import { RunMenu } from "./RunMenu";
import { RunTable } from "./RunTable";
import { TopBar } from "./TopBar";
import { SinkChip } from "./SinkChip";
import { TrendSection } from "./TrendChart";
import { VersionToggle } from "./VersionToggle";
import { CHART_FOOT, WinRateChart, rowStats } from "./WinRateChart";

/** Everything the dashboard layouts show and do, gathered by the screen that owns the state. */
export interface DashCtx {
  mock: boolean;
  run: PlaytestRun | null;
  facts: ResultFacts | null;
  roster: PlaytestRun | null;
  busy: boolean;
  live: LiveState;
  elapsed: number;
  error: string | null;
  notice: string | null;
  matchup: Matchup;
  onMatchup: (m: Matchup) => void;
  diagnose: boolean;
  onDiagnose: (on: boolean) => void;
  skill: BotSkill;
  onSkill: (s: BotSkill) => void;
  onRun: () => void;
  /** the same run judged again against a new intent */
  onReplace: (run: PlaytestRun) => void;
  theme: "dark" | "light";
  onTheme: () => void;
  showPatched: boolean;
  canPatch: boolean;
  replay: { seed: number; matchId?: string; heroes: [string, string]; source: ReplaySource | null };
  matches: {
    rows: MatchRow[];
    selected: string;
    onSelect: (id: string) => void;
    played: Parameters<typeof RunTable>[0]["played"];
  };
}

/** The Run button's words; the static build has no bots to run, only the recorded result to play back. */
function runLabel(busy: boolean): string {
  if (IS_STATIC) return busy ? "Replaying…" : "Replay recorded run";
  return busy ? "Bots are playing…" : "Let the bots play";
}

function Notices({ ctx }: { ctx: DashCtx }) {
  if (ctx.busy) return null;
  return (
    <>
      {ctx.notice && (
        <div className="notice" role="status">
          <span>{ctx.notice}</span>
          <button className="btn secondary" onClick={ctx.onRun}>
            Try live again
          </button>
        </div>
      )}
      {ctx.error && (
        <div className="err" role="alert">
          <p>{ctx.error}</p>
          <button className="btn secondary" onClick={ctx.onRun}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}

interface Section {
  id: string;
  title: string;
  note?: string;
  body: ReactNode;
}

const none = (text: string) => <p className="text-2">{text}</p>;

/** The accordion sections of the result. The all-matchups chart is not one of them: it is always on screen. */
function sectionsFor(ctx: DashCtx, report: Report | null, trend: ReactNode): Section[] {
  const { facts, run } = ctx;
  const changes = facts?.patch.length ?? 0;
  const targets = facts?.verdict?.targets ?? [];
  const patch = (
    <div className="d2-patch">
      <div className="d2-cols">
        {facts && !facts.fair ? (
          <PatchColumn patch={facts.patch} fallbackNote={facts.fallbackNote} />
        ) : (
          none("No patch for this run.")
        )}
        {facts && !facts.fair && <HoldoutColumn holdout={facts.holdout} verdict={facts.verdict} />}
      </div>
      {trend}
      <div className="d2-toggle">
        <VersionToggle disabled={!ctx.canPatch} hint="This run has no patched data to switch to." />
      </div>
    </div>
  );
  const diagnosis = facts?.diagnosis ? (
    <HeroProfile diagnosis={facts.diagnosis} patchPaths={facts.patchPaths} />
  ) : (
    none("No diagnosis in this run. Turn on Diagnose heroes in Options and run again.")
  );
  const evidence = (
    <div className="d2-cols">
      <div>{facts?.evidence ? <p>{facts.evidence}</p> : none("No evidence line in this run.")}</div>
      {facts?.others && <OthersColumn others={facts.others} note={facts.othersNote} />}
      <DesignerSection cases={loadDesigner()} />
    </div>
  );
  void report;
  return [
    {
      id: "patch",
      title: "Patch",
      note: changes ? `${changes} change${changes > 1 ? "s" : ""}` : undefined,
      body: patch,
    },
    { id: "diagnosis", title: "Diagnosis", body: diagnosis },
    {
      id: "targets",
      title: "Targets",
      note: targets.length ? String(targets.length) : undefined,
      body: targets.length ? <TargetRows targets={targets} /> : none("This verdict has no per-target rows."),
    },
    { id: "evidence", title: "Evidence", body: evidence },
    {
      id: "replay",
      title: "Replay",
      body: (
        <CompareReplay
          seed={ctx.replay.seed}
          storedMatchId={ctx.replay.matchId}
          heroes={ctx.replay.heroes}
          active={ctx.showPatched ? "patched" : "broken"}
          source={ctx.replay.source}
        />
      ),
    },
    {
      id: "matches",
      title: "Matches",
      body: ctx.mock ? (
        <MatchesTable rows={ctx.matches.rows} selected={ctx.matches.selected} onSelect={ctx.matches.onSelect} compact />
      ) : (
        <RunTable run={run} played={ctx.matches.played} />
      ),
    },
  ];
}

/** The roster on the right, always visible: the outlier on top, every row against its own intended band. */
interface RosterProps {
  ctx: DashCtx;
  bots: ReportRow[];
  humans: ReportRow[];
  /** the dimension the strip already asks "Intended?" about */
  shown?: string;
}

function Roster({ ctx, bots, humans, shown }: RosterProps) {
  const recorded = ctx.roster && bots.length < 5 ? botRows(ctx.roster.baseline.rows) : null;
  const rows = recorded ?? bots;
  return (
    <aside className="d2-right panel" aria-label="All matchups">
      <p className="eyebrow">All matchups</p>
      {rows.length > 0 ? (
        <WinRateChart
          rows={outliersFirst(rows.map(rowStats)).map((s) => s.row)}
          dense
          foot={false}
          rowAction={
            recorded
              ? undefined // the headline's own chips are in the strip, not repeated here
              : (s) =>
                  s.matchup.b && s.row.dimension !== shown ? (
                    <IntendedChips a={s.matchup.a} b={s.matchup.b} run={ctx.run} onRun={ctx.onReplace} />
                  ) : null
          }
        />
      ) : (
        none("The matchups appear here once the bots have played.")
      )}
      {humans.length > 0 && (
        <>
          <p className="eyebrow d2-group">Human players</p>
          <WinRateChart rows={humans} dense foot={false} />
        </>
      )}
      <p className="caption viz-foot">{CHART_FOOT}</p>
    </aside>
  );
}

/** The dashboard: topbar, headline strip (always above the fold), accordions on the left, the roster on the right. */
export function DashboardView({ ctx }: { ctx: DashCtx }) {
  const [intentOpen, setIntentOpen] = useState(false);
  const [flash, setFlash] = useState(0);
  const { run, facts } = ctx;
  const report = run ? (ctx.showPatched && run.patched ? run.patched : run.baseline) : null;
  const bots = report ? botRows(report.rows) : [];
  const humans = report ? humanRows(report.rows) : [];
  const stats = bots.map(rowStats);
  const shown = stats.find((s) => s.row.dimension === pickTargetDimension(stats));
  const trend = shown && shown.matchup.b ? <TrendSection a={shown.matchup.a} b={shown.matchup.b} /> : null;
  // The static build shows what the recorded data has: no diagnosis, evidence, replay or match list (need a server).
  const sections = useMemo(
    () => sectionsFor(ctx, report, trend).filter((s) => !IS_STATIC || ["patch", "targets"].includes(s.id)),
    [ctx, report, trend],
  );
  // The pickers and the headline name the same pair. In sample mode the picker is locked to the sample's pair; with a
  // live run, a different pick is said out loud instead of silently showing the old result.
  const measured: Matchup | null = shown && shown.matchup.b ? [shown.matchup.a, shown.matchup.b] : null;
  const pickerValue: Matchup = (ctx.mock || IS_STATIC) && measured ? measured : ctx.matchup;
  const stale =
    !ctx.mock && !IS_STATIC && measured && [...measured].sort().join() !== [...ctx.matchup].sort().join()
      ? `Showing the last run (${heroName(measured[0])} vs ${heroName(measured[1])}). Run again for the new pick.`
      : null;
  const detail = facts?.sourceDetail ? ` · ${facts.sourceDetail}` : "";
  const source = facts ? `${facts.source}${detail}` : ctx.mock ? "sample data" : "";
  const status: ReactNode = (
    <>
      {source && (
        <span className={`badge status-chip${facts?.source === "live run" ? " live" : " recorded"}`}>{source}</span>
      )}
      {stale && <span className="badge status-chip stale">{stale}</span>}
    </>
  );
  const actions = (
    <>
      <button className="btn secondary" onClick={() => setIntentOpen(true)}>
        Design intent
      </button>
      {facts && <CopyButton facts={facts} />}
    </>
  );
  const empty = (
    <>
      <p className="strip-mid">Pick a matchup above.</p>
      <p>The win rate, what was intended and the verdict appear here.</p>
    </>
  );
  return (
    <FitStage>
      <div className="screen dash2">
        <TopBar>
          <GameSwitch disabled={ctx.busy} />
          <span className="spacer" />
          <MatchupPicker
            value={pickerValue}
            onChange={ctx.onMatchup}
            disabled={ctx.busy || ctx.mock || IS_STATIC}
            title={
              IS_STATIC
                ? "Recorded demo: the matchup is fixed."
                : ctx.mock
                  ? "Sample data: the matchup is fixed."
                  : undefined
            }
          />
          <SinkChip />
          <RunMenu>
            {!IS_STATIC && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={ctx.diagnose && !ctx.mock}
                disabled={ctx.busy || ctx.mock}
                onChange={(e) => ctx.onDiagnose(e.target.checked)}
              />{" "}
              Diagnose heroes
            </label>
            )}
            {!IS_STATIC && (
              <BotSkillPicker value={ctx.skill} disabled={ctx.busy || ctx.mock} onChange={ctx.onSkill} />
            )}
            <button className="btn secondary" onClick={ctx.onTheme}>
              {ctx.theme === "dark" ? "Light theme" : "Dark theme"}
            </button>
            <a className="btn secondary" href="#/versions">
              Versions
            </a>
            <a className="btn secondary" href="#/intent">
              Design intent page
            </a>
            <a className="btn secondary" href="#/skill">
              Bot skill
            </a>
            <a className="btn secondary" href="#/present">
              Present
            </a>
          </RunMenu>
          <button className="btn primary" onClick={ctx.onRun} aria-busy={ctx.busy} aria-disabled={ctx.busy}>
            {ctx.busy && <span className="spinner" aria-hidden="true" />}
            {runLabel(ctx.busy)}
          </button>
        </TopBar>
        <HeadlineStrip
          key={`strip-${flash}`}
          shown={shown}
          headline={shown ? headlineFor(shown) : ""}
          facts={facts}
          busy={ctx.busy}
          live={ctx.live}
          elapsed={ctx.elapsed}
          status={status}
          actions={actions}
          chips={
            shown && shown.matchup.b ? (
              <IntendedChips
                a={shown.matchup.a}
                b={shown.matchup.b}
                run={run}
                onRun={(next) => {
                  ctx.onReplace(next);
                  setFlash((k) => k + 1);
                }}
              />
            ) : null
          }
          empty={empty}
        />
        <Notices ctx={ctx} />
        <main className="d2-main d2-split">
          <div className="d2-left">
            {ctx.busy ? (
              <ResultSkeleton live={ctx.live} elapsed={ctx.elapsed} />
            ) : !run ? (
              <EmptyResult onRun={ctx.onRun} />
            ) : (
              sections.map((sec) => (
                <Collapsible key={sec.id} title={sec.title} note={sec.note} defaultOpen={sec.id === "patch"}>
                  {sec.body}
                </Collapsible>
              ))
            )}
          </div>
          <Roster
            shown={shown?.row.dimension}
            ctx={ctx}
            bots={ctx.busy ? botRows(ctx.live.rows ?? []) : bots}
            humans={humans}
          />
        </main>
        {intentOpen && <IntentModal onClose={() => setIntentOpen(false)} />}
      </div>
    </FitStage>
  );
}
