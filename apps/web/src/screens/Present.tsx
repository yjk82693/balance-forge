import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IntendedChips } from "../components/IntendedChips";
import { phaseWords } from "../components/ResultSkeleton";
import { CompareReplay } from "../components/CompareReplay";
import { FitStage } from "../components/FitStage";
import { HeroPortrait } from "../components/HeroPortrait";
import { TopBar } from "../components/TopBar";
import { WinRateChart, rowStats } from "../components/WinRateChart";
import { VERDICT_COPY, fmtSeconds, headlineFor, n, pickTargetDimension } from "../lib/dashboardData";
import { fixtureMatchConfig } from "../lib/fixtures";
import { botRows } from "../lib/groups";
import { heroName } from "../lib/heroes";
import { loadJustPlayed } from "../lib/justPlayed";
import { loadSkill, policyFor } from "../lib/botPolicy";
import { currentDiagnose, currentMatchup } from "../lib/matchup";
import { buildFacts, fallbackNote, needsMoreGames } from "../lib/resultCard";
import { originLabel } from "../lib/fullRun";
import { outcomeWords, targetWords, waveChangeLabel, waveName } from "../lib/tentacleDash";
import { pct } from "../lib/stats";
import { loadRecordedRun } from "../lib/recorded";
import { TENTACLE_RUN_ENABLED } from "../lib/featureFlags";
import { IS_STATIC } from "../lib/staticMode";
import { loadStaticRun } from "../lib/staticRun";
import { shouldStartOnMount } from "../lib/presentStart";
import { scenesFor, usePresenter, type SceneId } from "../lib/presenter";
import { useReplaySource } from "../lib/replaySource";
import { useRunner } from "../lib/useRunner";
import { loadRun } from "../lib/dashboardData";
import { heroName as deckLabel } from "../lib/heroes";
import { HeroProfile } from "../components/HeroProfile";
import { VersionHistory } from "../components/VersionHistory";
import { useManifest } from "../lib/assets";
import { loadDesigner } from "../lib/designer";
import { useHeroStats } from "../lib/heroStats";
import { DesignerSection } from "../components/DesignerCard";
import { IntentGrid } from "../components/IntentGrid";
import { getIntent, hasIntent, useIntent } from "../lib/intent";
import { fetchVersions, loadHistory, summaryLine, type HistorySource, type VersionList } from "../lib/versions";
import { isMockMode } from "../mock/types";
import type { PlaytestRun } from "../lib/api";

/** Where the numbers on screen come from. Shown the whole time. */
function sourceLabel(run: PlaytestRun | null, recorded: boolean, mock: boolean): { text: string; cls: string } {
  if (mock) return { text: "sample data", cls: "" };
  if (recorded || run?.baseline.recorded) {
    const b = run?.baseline;
    const took = b?.elapsedMs != null ? ` · ${fmtSeconds(b.elapsedMs)}` : "";
    const bits = b ? ` · ${n(b.validMatches)} matches${took}` : "";
    return { text: `recorded${bits}`, cls: "recorded" };
  }
  return { text: "live run", cls: "live" };
}

export function Present({ auto }: { auto: boolean }) {
  useManifest();
  useHeroStats();
  const mock = isMockMode();
  const { run: lastRun, busy, live, error, notice, elapsed, start, replace } = useRunner();
  // Opening the screen starts nothing: it shows the last stored live result, else the recorded one.
  const [recorded, setRecorded] = useState<PlaytestRun | null>(null);
  const run = lastRun ?? recorded;
  const started = useRef(false);
  const roster = useRef<PlaytestRun | null>(null);
  // Same matchup as the dashboard: a pick made there, else the match just played, else the roster's largest outlier.
  const matchup = useCallback(() => currentMatchup(loadJustPlayed(), roster.current), []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadRecordedRun()
      .then((r) => {
        roster.current = r;
        setRecorded(r);
      })
      .catch(() => null)
      .finally(() => {
        if (shouldStartOnMount({ auto, mock })) {
          void start(matchup(), currentDiagnose(matchup(), roster.current), policyFor(loadSkill()));
        }
      });
  }, [start, matchup, auto, mock]);

  const finished = !!run && !busy;
  const ready = useCallback((id: SceneId) => id !== "bots" || finished || !!error, [finished, error]);
  const restart = useCallback(
    () => void start(matchup(), currentDiagnose(matchup(), roster.current), policyFor(loadSkill())),
    [start, matchup],
  );
  const history = useHistory(finished);
  const hasProfile = !!run?.diagnosis;
  const hasHistory = !!history && (history.list.versions.length > 1 || designerCases(history).length > 0);
  const intent = useIntent();
  const wantsIntent = hasIntent(intent);
  // The last Hero Cards result of this tab, if there is one: it adds one scene (never a request).
  const [staticCards, setStaticCards] = useState<PlaytestRun | null>(null);
  useEffect(() => {
    if (IS_STATIC) loadStaticRun("hero_cards").then(setStaticCards, () => null);
  }, []);
  const cardsRun = useMemo(
    () => (IS_STATIC ? staticCards : mock ? null : loadRun("hero_cards")),
    [mock, staticCards],
  );
  // And the last Sepia Tentacle Run result of this tab: one more scene, no request.
  const soloRun = useMemo(
    () => (IS_STATIC || mock || !TENTACLE_RUN_ENABLED ? null : loadRun("tentacle_run")),
    [mock],
  );
  const scenes = useMemo(
    () =>
      scenesFor({
        intent: wantsIntent,
        profile: hasProfile,
        history: hasHistory,
        cards: !!cardsRun,
        solo: !!soloRun?.tentacle,
        replay: !IS_STATIC,
      }),
    [wantsIntent, hasProfile, hasHistory, cardsRun, soloRun],
  );
  const { index, scene, held, paused } = usePresenter(scenes, ready, restart);
  const source = sourceLabel(run, !!notice || (!lastRun && !!recorded), mock);

  return (
    <FitStage>
      <div className={`screen present${auto ? " auto" : ""}`}>
        <TopBar>
          <span className="eyebrow" style={{ color: "var(--game-arena)" }}>
            HERO ARENA
          </span>
          <span className="small text-2">Balance check</span>
          <span className="spacer" />
          <span className={`badge ${source.cls}`}>{source.text}</span>
          {paused && <span className="badge">paused</span>}
        </TopBar>
        <ol className="present-steps" aria-label="Steps" style={{ ["--steps" as string]: scenes.length }}>
          {scenes.map((s, i) => (
            <li key={s.id} className={i === index ? "on" : i < index ? "done" : ""} aria-current={i === index}>
              <span className="present-step-bar">
                <span style={{ width: i === index && s.min ? `${Math.min(100, (held / s.min) * 100)}%` : "" }} />
              </span>
              <span className="caption">{s.title}</span>
            </li>
          ))}
        </ol>
        <main className="present-stage" aria-live="polite">
          <SceneBody
            id={scene.id}
            run={run}
            busy={busy}
            live={live}
            elapsed={elapsed}
            error={error}
            notice={notice}
            history={history}
            cardsRun={cardsRun}
            soloRun={soloRun}
            onRun={replace}
            onStart={restart}
          />
        </main>
        {!auto && (
          <footer className="present-keys caption">
            Space / → next · ← back · P pause · R {IS_STATIC ? "replay" : "run live"}
          </footer>
        )}
      </div>
    </FitStage>
  );
}

interface BodyProps {
  id: SceneId;
  run: PlaytestRun | null;
  busy: boolean;
  live: ReturnType<typeof useRunner>["live"];
  elapsed: number;
  error: string | null;
  notice: string | null;
  history: HistoryState | null;
  cardsRun: PlaytestRun | null;
  soloRun: PlaytestRun | null;
  onRun: (next: PlaytestRun) => void;
  /** start a new live run (R, or the button on the bots scene) */
  onStart: () => void;
}

function SceneBody(props: BodyProps) {
  const { id, run, busy, live, elapsed, error, notice, history, cardsRun, soloRun, onRun, onStart } = props;
  switch (id) {
    case "intent":
      return <IntentScene />;
    case "history":
      return <HistoryScene history={history} />;
    case "cards":
      return <CardsScene run={cardsRun} />;
    case "solo":
      return <SoloScene run={soloRun} />;
    case "profile":
      return <ProfileScene run={run} />;
    case "match":
      return <MatchScene />;
    case "bots":
      return (
        <BotsScene
          run={run}
          busy={busy}
          live={live}
          elapsed={elapsed}
          error={error}
          notice={notice}
          onStart={onStart}
        />
      );
    case "patch":
      return <PatchScene run={run} busy={busy} error={error} />;
    case "replay":
      return <ReplayScene run={run} busy={busy} />;
    default:
      return <VerdictScene run={run} busy={busy} error={error} onRun={onRun} />;
  }
}

interface HistoryState {
  list: VersionList;
  source: HistorySource;
}

/**
 * The version history for the last scene: the live list (read again once the run is finished, since a run can add a
 * version), else the stored one. Null while loading or when there is none, and the scene is then left out.
 */
function useHistory(runFinished: boolean): HistoryState | null {
  const [state, setState] = useState<HistoryState | null>(null);
  useEffect(() => {
    let alive = true;
    const job: Promise<HistoryState | null> =
      runFinished && state?.source === "live run"
        ? fetchVersions()
            .then((list) => (list ? { list, source: "live run" as const } : null))
            .catch(() => null)
        : loadHistory().then((h) => (h.list ? { list: h.list, source: h.source } : null));
    job.then((next) => alive && next && setState(next));
    return () => {
      alive = false;
    };
  }, [runFinished]);
  return state;
}

/** Heroes handed to a designer: from the list itself, else from the last auto-balance run in this tab. */
const designerCases = (h: HistoryState) => h.list.needsDesigner ?? loadDesigner();

/** Auto-balance rounds as the Versions screen shows them, read only. */
function HistoryScene({ history }: { history: HistoryState | null }) {
  if (!history) return <Waiting what="the version history" />;
  return (
    <section className="present-wide panel">
      <div className="panel-head">
        <span className="eyebrow">Version history, newest first</span>
        <span className={`badge${history.source === "live run" ? "" : " recorded"}`}>{history.source}</span>
        {summaryLine(history.list.summary) && <span className="caption">{summaryLine(history.list.summary)}</span>}
      </div>
      <DesignerSection cases={designerCases(history)} />
      <VersionHistory versions={history.list.versions} currentHash={history.list.currentHash} />
    </section>
  );
}

/** The designer's chart, read only, shown before the bots run: what each matchup is supposed to come to. */
function IntentScene() {
  return (
    <section className="present-wide panel present-intent">
      <div className="panel-head">
        <span className="eyebrow">What the designer wants</span>
      </div>
      <IntentGrid intent={getIntent()} />
    </section>
  );
}

/** The hero profile of the run's diagnosis, large; the scene is left out when the run has none. */
function ProfileScene({ run }: { run: PlaytestRun | null }) {
  if (!run?.diagnosis) return <Waiting what="the hero profile" />;
  const paths = (run.proposal?.changes ?? []).map((c) => c.path);
  const fallback = run.proposal?.patch.replacements.map((r) => r.path) ?? [];
  return (
    <section className="present-wide panel present-profile">
      <HeroProfile diagnosis={run.diagnosis} patchPaths={paths.length ? paths : fallback} />
    </section>
  );
}

/** The human match that just ended, when there is one; otherwise only the title. */
function MatchScene() {
  const played = loadJustPlayed();
  if (!played) {
    return (
      <section className="present-card">
        <h1 className="display">Is the game fair?</h1>
        <p className="h3 text-2">Bots play it thousands of times and a model proposes a patch.</p>
      </section>
    );
  }
  const { result, heroes, names } = played;
  const seats = Object.keys(heroes);
  return (
    <section className="present-card">
      <p className="eyebrow">You just played</p>
      <div className="present-duel">
        {seats.map((seat) => (
          <div key={seat} className="present-fighter">
            <HeroPortrait hero={heroes[seat]} size={120} />
            <p className="h3">{names[seat] || heroName(heroes[seat])}</p>
            <p className="caption">{heroName(heroes[seat])}</p>
          </div>
        ))}
      </div>
      <p className="h2">
        {result.outcome.status === "win"
          ? `${names[result.outcome.winners[0]] || result.outcome.winners[0]} won`
          : "Draw"}
      </p>
      <p className="text-2">Now the bots play the same game.</p>
    </section>
  );
}

function Waiting({ what, error }: { what: string; error?: string | null }) {
  return (
    <section className="present-card">
      <p className="h2">{error ? "No result to show." : `Waiting for ${what}…`}</p>
      {error ? (
        <p className="text-2" role="alert">
          {error}
        </p>
      ) : (
        <div className="progress waiting" role="progressbar" aria-label={`Waiting for ${what}`}>
          <span />
        </div>
      )}
    </section>
  );
}

/** The one number of this scene: the flagged matchup's win rate, big, against what was intended. */
function BigRate({ run }: { run: PlaytestRun }) {
  const stats = botRows(run.baseline.rows).map(rowStats);
  const s = stats.find((x) => x.row.dimension === pickTargetDimension(stats));
  if (!s) return null;
  return (
    <div className="present-big-block">
      <p className="present-names">
        <HeroPortrait hero={s.matchup.a} size={72} />
        {heroName(s.matchup.a)} <span className="text-2">vs</span> {heroName(s.matchup.b)}
        <HeroPortrait hero={s.matchup.b} size={72} />
      </p>
      <p className="present-big">{pct(s.rate)}%</p>
      <p className="present-mid">
        {s.target.favored ? s.target.label : "intended: even (50%)"} · {n(s.row.games)} games
      </p>
      <p className="present-sub">{headlineFor(s)}</p>
    </div>
  );
}

type BotsProps = Omit<BodyProps, "id" | "history" | "cardsRun" | "soloRun" | "onRun">;

function BotsScene({ run, busy, live, elapsed, error, notice, onStart }: BotsProps) {
  if (!busy && !run && !error) {
    return (
      <section className="present-card">
        <p className="h2">No stored result to show.</p>
        <button type="button" className="btn primary present-run-live" onClick={onStart}>
          {IS_STATIC ? "Replay recorded run" : "Run live"}
        </button>
      </section>
    );
  }
  if (busy || !run) {
    const rows = live.rows;
    return (
      <section className="present-card">
        <p className="present-sub">{phaseWords(live.phase)}…</p>
        <p className="present-big">{live.total ? `${n(live.done)}` : "…"}</p>
        <p className="present-mid">
          {live.total ? `of ${n(live.total)} matches · ` : ""}
          {elapsed} s
        </p>
        {!rows && error && <Waiting what="the first results" error={error} />}
      </section>
    );
  }
  return (
    <div className="present-bots">
      <BigRate run={run} />
      <section className="panel present-roster">
        <p className="eyebrow">All matchups</p>
        <WinRateChart rows={run.baseline.rows} dense foot={false} />
        {notice && <p className="present-sub">{notice}</p>}
        <button type="button" className="btn secondary present-run-live" onClick={onStart}>
          {IS_STATIC ? "Replay recorded run" : "Run live"}
        </button>
      </section>
    </div>
  );
}

/** A Sepia Tentacle Run result: the flagged wave before and after the patch, the patch and the verdict, big. */
function SoloScene({ run }: { run: PlaytestRun | null }) {
  const t = run?.tentacle;
  if (!run || !t) return null;
  const f = t.flagged;
  const after = f ? t.patchedWaves.find((w) => w.wave === f.wave)?.clearRate : null;
  const v = run.verdict && !run.fair ? VERDICT_COPY[run.verdict.verdict] : null;
  const note = fallbackNote(run);
  const t4 = f ? t.targets.find((x) => x.wave === f.wave) : undefined;
  return (
    <section className="present-card">
      <p className="present-sub">Same platform, a solo action game</p>
      <p className="present-names">{f ? waveName(f.wave) : "Every section"}</p>
      <p className="present-big">
        {f ? `${pct(f.clearRate)}%` : t.winRate === null ? "—" : `${pct(t.winRate)}%`}
        {f && after != null && (
          <>
            {" "}
            <span className="text-2">→</span> {pct(after)}%
          </>
        )}
      </p>
      <p className="present-mid">
        {f
          ? `${waveName(f.wave)} clears ${pct(f.clearRate)}% of the time; ${targetWords(t4?.band ?? null, f.target)}`
          : "Within target"}
      </p>
      {(run.proposal?.changes ?? []).slice(0, 2).map((c) => (
        <p key={c.path} className="present-change">
          {waveChangeLabel(c.path) ?? c.label ?? c.path} <span className="old">{c.old ?? "—"}</span> →{" "}
          <span className="new">{c.new}</span> <span className="badge origin">{originLabel(run.proposal!.origin)}</span>
        </p>
      ))}
      {v && (
        <p className={`present-verdict status ${v.cls}`} role="status">
          <span className="dot" />
          {v.label}
          {t4 && ` · ${outcomeWords(t4.outcome)}`}
        </p>
      )}
      {run.verdict?.reasons[1] && <p className="present-sub">{run.verdict.reasons[1]}</p>}
      {note && <p className="present-sub present-fallback">{note}</p>}
    </section>
  );
}

/** A Hero Cards result in the same shape as the arena's: the headline and the card change, big. */
function CardsScene({ run }: { run: PlaytestRun | null }) {
  if (!run) return null;
  const stats = botRows(run.baseline.rows).map(rowStats);
  const s = stats.find((x) => x.row.dimension === pickTargetDimension(stats));
  if (!s) return null;
  const facts = buildFacts(run, null);
  const after = run.patched?.rows.find((r) => r.dimension === s.row.dimension);
  const v = run.verdict && !run.fair ? VERDICT_COPY[run.verdict.verdict] : null;
  return (
    <section className="present-card">
      <p className="present-sub">Same platform, a card game</p>
      <p className="present-names">
        {deckLabel(s.matchup.a)} <span className="text-2">vs</span> {deckLabel(s.matchup.b)}
      </p>
      <p className="present-big">
        {pct(s.rate)}%
        {after && (
          <>
            {" "}
            <span className="text-2">→</span> {pct(after.winRate)}%
          </>
        )}
      </p>
      <p className="present-mid">{headlineFor(s)}</p>
      {facts.patch.slice(0, 2).map((c) => (
        <p key={c.path} className="present-change">
          {c.field} <span className="old">{c.old ?? "—"}</span> → <span className="new">{c.next}</span>{" "}
          <span className="badge origin">{c.origin}</span>
        </p>
      ))}
      {v && (
        <p className={`present-verdict status ${v.cls}`} role="status">
          <span className="dot" />
          {v.label}
        </p>
      )}
      {facts.fallbackNote && <p className="present-sub present-fallback">{facts.fallbackNote}</p>}
    </section>
  );
}

/** The server called the matchup fair: there is no patch, holdout or verdict to show. */
function FairCard() {
  return (
    <section className="present-card">
      <p className="present-verdict status ok" role="status">
        <span className="dot" />
        Fair
      </p>
      <p className="h3 text-2">No patch needed for this matchup.</p>
    </section>
  );
}

function PatchScene({ run, busy, error }: { run: PlaytestRun | null; busy: boolean; error: string | null }) {
  if (!run) return <Waiting what="the patch" error={busy ? null : error} />;
  if (run.fair) return <FairCard />;
  if (!run.proposal) {
    return (
      <section className="present-card">
        <p className="present-mid">This data has no patch proposal.</p>
        <p className="present-sub">The stored run holds the bot results only.</p>
      </section>
    );
  }
  const facts = buildFacts(run, null);
  const first = facts.patch[0];
  return (
    <section className="present-card">
      <p className="present-sub">
        The AI proposes <span className="badge origin">{first?.origin ?? run.proposal.origin}</span>
      </p>
      {facts.patch.map((c) => (
        <p key={c.path} className="present-change">
          {c.field} <span className="old">{c.old ?? "—"}</span> → <span className="new">{c.next}</span>
        </p>
      ))}
      {facts.fallbackNote && <p className="present-sub present-fallback">{facts.fallbackNote}</p>}
      {first?.rationale && <p className="present-sub">{first.rationale}</p>}
    </section>
  );
}

function ReplayScene({ run, busy }: { run: PlaytestRun | null; busy: boolean }) {
  const source = useReplaySource(run);
  if (!run) return <Waiting what="the replay" error={busy ? null : "The run did not finish."} />;
  const stats = botRows(run.baseline.rows).map(rowStats);
  const target = stats.find((s) => s.row.dimension === pickTargetDimension(stats));
  const heroes: [string, string] = target
    ? [target.matchup.a, target.matchup.b || target.matchup.a]
    : ["bari", "real_armor"];
  return (
    <div className="present-wide">
      <CompareReplay
        seed={run.replay?.seed ?? fixtureMatchConfig.seed}
        storedMatchId={run.replay?.matchId}
        heroes={heroes}
        active={run.patched ? "patched" : "broken"}
        source={source}
      />
    </div>
  );
}

/** The badge shows what the run's verdict says, never text written in advance. Before → after is the one number. */
function VerdictScene({
  run,
  busy,
  error,
  onRun,
}: {
  run: PlaytestRun | null;
  busy: boolean;
  error: string | null;
  onRun: (next: PlaytestRun) => void;
}) {
  if (!run) return <Waiting what="the verdict" error={busy ? null : error} />;
  if (run.fair) return <FairCard />;
  if (!run.verdict) {
    return (
      <section className="present-card">
        <p className="present-mid">This run has no verdict.</p>
        <p className="present-sub">The data has no patched run to judge.</p>
      </section>
    );
  }
  const v = VERDICT_COPY[run.verdict.verdict];
  const stats = botRows(run.baseline.rows).map(rowStats);
  const before = stats.find((x) => x.row.dimension === pickTargetDimension(stats));
  const after = run.patched?.rows.find((r) => r.dimension === before?.row.dimension);
  const more = needsMoreGames(run.verdict.reasons);
  const note = buildFacts(run, null).fallbackNote;
  return (
    <section className="present-card">
      <p className={`present-verdict status ${v.cls}`} role="status">
        <span className="dot" />
        {v.glyph}
        {v.label}
      </p>
      {before && after && (
        <p className="present-big">
          {pct(before.rate)}% <span className="text-2">→</span> {pct(after.winRate)}%
        </p>
      )}
      <p className="present-mid">{more ?? run.verdict.reasons[0] ?? ""}</p>
      {note && <p className="present-sub present-fallback">{note}</p>}
      {before?.outlier && before.matchup.b && (
        <IntendedChips a={before.matchup.a} b={before.matchup.b} run={run} onRun={onRun} big />
      )}
    </section>
  );
}
