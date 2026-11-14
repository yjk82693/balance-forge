import { useCallback, useEffect, useRef } from "react";
import { CompareReplay } from "../components/CompareReplay";
import { DiffCard } from "../components/DiffCard";
import { FitStage } from "../components/FitStage";
import { HeroPortrait } from "../components/HeroPortrait";
import { LivePanel } from "../components/LivePanel";
import { PatchCompare } from "../components/PatchCompare";
import { TopBar } from "../components/TopBar";
import { WinRateChart, rowStats } from "../components/WinRateChart";
import { VERDICT_COPY, fmtSeconds, n, pickTargetDimension } from "../lib/dashboardData";
import { fixtureMatchConfig } from "../lib/fixtures";
import { botRows } from "../lib/groups";
import { heroName } from "../lib/heroes";
import { loadJustPlayed } from "../lib/justPlayed";
import { SCENES, usePresenter, type SceneId } from "../lib/presenter";
import { useReplaySource } from "../lib/replaySource";
import { useRunner } from "../lib/useRunner";
import { useManifest } from "../lib/assets";
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
  const mock = isMockMode();
  const { run, busy, live, error, notice, elapsed, start } = useRunner();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const finished = !!run && !busy;
  const ready = useCallback((id: SceneId) => id !== "bots" || finished || !!error, [finished, error]);
  const restart = useCallback(() => void start(), [start]);
  const { index, scene, held, paused } = usePresenter(ready, restart);
  const source = sourceLabel(run, !!notice, mock);

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
        <ol className="present-steps" aria-label="Steps">
          {SCENES.map((s, i) => (
            <li key={s.id} className={i === index ? "on" : i < index ? "done" : ""} aria-current={i === index}>
              <span className="present-step-bar">
                <span style={{ width: i === index && s.min ? `${Math.min(100, (held / s.min) * 100)}%` : "" }} />
              </span>
              <span className="caption">{s.title}</span>
            </li>
          ))}
        </ol>
        <main className="present-stage" aria-live="polite">
          <SceneBody id={scene.id} run={run} busy={busy} live={live} elapsed={elapsed} error={error} notice={notice} />
        </main>
        {!auto && (
          <footer className="present-keys caption">
            Space / → next · ← back · P pause · R restart
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
}

function SceneBody({ id, run, busy, live, elapsed, error, notice }: BodyProps) {
  switch (id) {
    case "match":
      return <MatchScene />;
    case "bots":
      return <BotsScene run={run} busy={busy} live={live} elapsed={elapsed} error={error} notice={notice} />;
    case "patch":
      return <PatchScene run={run} busy={busy} error={error} />;
    case "replay":
      return <ReplayScene run={run} busy={busy} />;
    default:
      return <VerdictScene run={run} busy={busy} error={error} />;
  }
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

function BotsScene({ run, busy, live, elapsed, error, notice }: Omit<BodyProps, "id">) {
  const rows = live.rows ?? run?.baseline.rows ?? null;
  return (
    <div className="present-bots">
      <LivePanel busy={busy} done={live.done} total={live.total} phase={live.phase} elapsed={elapsed} />
      <section className="panel">
        <div className="panel-head">
          <span className="eyebrow">Win rate per matchup</span>
        </div>
        {rows ? <WinRateChart rows={rows} dense /> : <Waiting what="the first results" error={error} />}
        {notice && <p className="caption">{notice}</p>}
      </section>
    </div>
  );
}

function PatchScene({ run, busy, error }: { run: PlaytestRun | null; busy: boolean; error: string | null }) {
  if (!run) return <Waiting what="the patch" error={busy ? null : error} />;
  if (!run.proposal) {
    return (
      <section className="present-card">
        <p className="h2">This data has no patch proposal.</p>
        <p className="text-2">The stored run holds the bot results only.</p>
      </section>
    );
  }
  return (
    <div className="present-wide">
      <DiffCard proposal={run.proposal} sample={run.sample} />
    </div>
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

/** The badge shows what the run's verdict says, never text written in advance. */
function VerdictScene({ run, busy, error }: { run: PlaytestRun | null; busy: boolean; error: string | null }) {
  if (!run) return <Waiting what="the verdict" error={busy ? null : error} />;
  if (!run.verdict) {
    return (
      <section className="present-card">
        <p className="h2">This run has no verdict.</p>
        <p className="text-2">The data has no patched run to judge.</p>
      </section>
    );
  }
  const v = VERDICT_COPY[run.verdict.verdict];
  return (
    <section className="present-card">
      <p className={`present-verdict status ${v.cls}`} role="status">
        <span className="dot" />
        {v.glyph}
        {v.label}
      </p>
      {run.verdict.reasons.slice(0, 2).map((r) => (
        <p key={r} className="h3 text-2">
          {r}
        </p>
      ))}
      {run.patched && (
        <div className="present-compare panel">
          <PatchCompare before={run.baseline} after={run.patched} showAfter />
        </div>
      )}
    </section>
  );
}
