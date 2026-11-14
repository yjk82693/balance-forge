import { useEffect, useRef, useState } from "react";
import { ArenaCanvas } from "../components/ArenaCanvas";
import { MatchesTable, type MatchRow } from "../components/MatchesTable";
import { PatchCompare, describePath } from "../components/PatchCompare";
import { VersionToggle } from "../components/VersionToggle";
import { WinRateChart, rowStats } from "../components/WinRateChart";
import { TopBar } from "../components/TopBar";
import { useManifest } from "../lib/assets";
import { heroName } from "../lib/heroes";
import { pct } from "../lib/stats";
import { ApiError, runPlaytest, type PlaytestRun, type VerdictKind } from "../lib/api";
import { useDemoVersion } from "../lib/demo";
import { fixtureMatchEnded, fixtureMatchResults, fixtureObservation, fixtureRoomStatus } from "../lib/fixtures";
import { isMockMode } from "../mock/types";
import { replayObservation } from "../mock/mockServer";
import type { Observation, Report } from "../lib/contract";

const MATCHES = 1000;
type Theme = "dark" | "light";
const readTheme = (): Theme => {
  try {
    return localStorage.getItem("bf-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};
const loadRun = (): PlaytestRun | null => {
  try {
    const raw = sessionStorage.getItem("bf-last-run");
    return raw ? (JSON.parse(raw) as PlaytestRun) : null;
  } catch {
    return null;
  }
};

const fmtSeconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);
const n = (x: number) => x.toLocaleString("en-US");

/** Loops the Observation fixture as the canvas backdrop until the engine streams real replays. */
function useReplay(): Observation {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setFrame((f) => f + 1), 100);
    return () => clearInterval(t);
  }, []);
  return replayObservation(frame, []);
}

const HUMAN_ID = fixtureMatchEnded.payload.result.matchId;
const HEROES_BY_SEAT = Object.fromEntries(fixtureObservation.payload.entities.map((e) => [e.id, e.hero]));
const NAMES_BY_SEAT: Record<string, string> = Object.fromEntries(fixtureRoomStatus.payload.seats.map((s) => [s.seat, s.name]));
const sampleRows: MatchRow[] = fixtureMatchResults.map((result) => {
  const human = result.matchId === HUMAN_ID;
  return { result, human, heroes: human ? HEROES_BY_SEAT : {}, names: human ? NAMES_BY_SEAT : {} };
});

const VERDICT_COPY: Record<VerdictKind, { label: string; cls: string; glyph: string }> = {
  accepted: { label: "Accepted", cls: "ok", glyph: "" },
  rejected: { label: "Rejected", cls: "bad", glyph: "" },
  inconclusive: { label: "Inconclusive", cls: "warn", glyph: "▲ " },
};

function recordedLine(r: Report, sample?: boolean) {
  const parts = [`${n(r.validMatches)} matches`];
  if (typeof r.elapsedMs === "number") parts.push(fmtSeconds(r.elapsedMs));
  return (
    <>
      {r.recorded || sample ? <span className="badge recorded">recorded · {parts.join(" · ")}</span> : <span className="badge">{parts.join(" · ")}</span>}
      {sample && <span className="badge">sample data</span>}
    </>
  );
}

export function Dashboard() {
  useManifest();
  const mock = isMockMode();
  const version = useDemoVersion();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [run, setRun] = useState<PlaytestRun | null>(() => (mock ? null : loadRun()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(HUMAN_ID);
  const abort = useRef<AbortController | null>(null);
  const observation = useReplay();

  // Light is for projecting this screen only; every other screen stays dark.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("bf-theme", theme);
    } catch {
      /* private mode */
    }
    return () => {
      document.documentElement.dataset.theme = "dark";
    };
  }, [theme]);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    try {
      const result = await runPlaytest(MATCHES, abort.current.signal);
      setRun(result);
      if (!mock) {
        try {
          sessionStorage.setItem("bf-last-run", JSON.stringify(result));
        } catch {
          /* too big or blocked: keep it in memory only */
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const canPatch = !!run?.patched;
  const showPatched = canPatch && version === "patched";
  const report = run ? (showPatched ? run.patched! : run.baseline) : null;
  const stats = report?.rows.map(rowStats) ?? [];
  const top = [...stats].sort((a, b) => Math.abs(b.rate - 0.5) - Math.abs(a.rate - 0.5));
  const outlier = stats.find((s) => s.outlier);
  const shown = outlier ?? top[0];
  const headline = outlier ? `${heroName(outlier.matchup.a)} wins too often against ${heroName(outlier.matchup.b)}` : "Within normal range";
  const base = run ? rowStats(run.baseline.rows.find((r) => r.dimension === shown?.row.dimension) ?? run.baseline.rows[0]) : null;

  return (
    <div className="screen dash">
      <TopBar>
        <span className="eyebrow" style={{ color: "var(--game-arena)" }}>
          HERO ARENA
        </span>
        <span className="small text-2">Balance report{run ? ` · ${showPatched ? "patched" : "broken"} data` : ""}</span>
        <span className="spacer" />
        <VersionToggle />
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
              <span className="meta">{mock ? "sample matches" : "from the last run"}</span>
            </div>
            {mock ? (
              <MatchesTable rows={sampleRows} selected={selected} onSelect={setSelected} />
            ) : (
              <table className="matches">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th className="num">Matches</th>
                    <th className="num">Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody aria-live="polite">
                  <tr>
                    <td>
                      <span className="players">
                        <span className="badge human">human</span> Human matches
                      </span>
                    </td>
                    <td className="num">{run ? n(run.baseline.humanMatches ?? 0) : "—"}</td>
                    <td className="num">—</td>
                    <td>
                      {(run?.baseline.humanMatches ?? 0) > 0 ? <span className="badge recorded">recorded</span> : <span className="caption">{run ? "None yet" : "Waiting for a run"}</span>}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span className="players">
                        <span className="badge">bot</span> Bot v bot
                      </span>
                    </td>
                    <td className="num">{run ? n(run.baseline.validMatches) : "—"}</td>
                    <td className="num">{run?.baseline.elapsedMs != null ? fmtSeconds(run.baseline.elapsedMs) : "—"}</td>
                    <td>{run?.baseline.recorded ? <span className="badge recorded">recorded</span> : <span className="caption">{run ? "Live run" : "Waiting for a run"}</span>}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="dash-right">
          <section className="panel report" aria-labelledby="report-title" aria-busy={busy}>
            <div className="panel-head">
              <span id="report-title" className="eyebrow">
                Balance report
              </span>
              {report && <span className="meta">n = {n(report.validMatches)}</span>}
            </div>

            {error && (
              <div className="err" role="alert">
                <p className="small">{error} Check that the server is running, then try again.</p>
                <button className="btn secondary" onClick={start}>
                  Try again
                </button>
              </div>
            )}

            {!run && !error && (
              <div className="empty">
                <p className="h3">{busy ? "Bots are playing…" : "No runs yet."}</p>
                <p className="text-2">{busy ? "This takes a few seconds." : "Let the bots play to see a report."}</p>
                {busy && <div className="skeleton" aria-hidden="true" />}
              </div>
            )}

            {run && report && shown && base && (
              <>
                <h1 className="h2">{headline}</h1>
                <p className="kpi">
                  {pct(shown.rate)}% · {n(shown.row.games)} games{report.elapsedMs != null ? ` · ${fmtSeconds(report.elapsedMs)}` : ""}
                </p>
                <p className="report-meta">
                  {recordedLine(report, run.sample)}
                  <span className="caption">
                    {report.seedSetId} · {report.draws} draws
                  </span>
                </p>
                <hr className="divider" />
                <p className="eyebrow" style={{ color: "var(--text-2)" }}>
                  Win rate by matchup
                </p>
                <WinRateChart rows={top.slice(0, 4).map((s) => s.row)} />

                {run.proposal && (
                  <>
                    <hr className="divider" />
                    <div className="panel-head">
                      <span className="eyebrow">Suggested patch</span>
                      <span className="badge origin" title="Where the proposal came from">
                        {run.proposal.origin}
                      </span>
                      <span className="meta">
                        {run.proposal.validation.ok ? (
                          <span className="status ok">
                            <span className="dot" />
                            valid
                          </span>
                        ) : (
                          <span className="status bad">
                            <span className="dot" />
                            rejected by validation
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="small patch-note">
                      {run.proposal.patch.replacements.map((r) => `${describePath(r.path)} → ${r.value}`).join(" · ")}
                    </p>
                    <p className="caption patch-why">{run.proposal.patch.rationale}</p>
                    {run.proposal.validation.errors.slice(0, 2).map((e) => (
                      <p key={e} className="caption" style={{ color: "var(--danger)" }}>
                        {e}
                      </p>
                    ))}
                    {run.patched && <PatchCompare before={run.baseline} after={run.patched} showAfter={showPatched} />}
                  </>
                )}

                {run.verdict && (
                  <p className="verdict" role="status">
                    <span className={`status ${VERDICT_COPY[run.verdict.verdict].cls}`}>
                      <span className="dot" />
                      {VERDICT_COPY[run.verdict.verdict].glyph}
                      {VERDICT_COPY[run.verdict.verdict].label}
                    </span>
                    {run.verdict.reasons[0] && <span className="caption">{run.verdict.reasons[0]}</span>}
                  </p>
                )}
                {showPatched && (
                  <p className="caption">
                    {heroName(shown.matchup.a)} {pct(base.rate)}% → {pct(shown.rate)}% · 95% CI {pct(shown.lo)}–{pct(shown.hi)}%
                  </p>
                )}
                {run.proposal && !canPatch && <p className="caption">Run the patched data to compare.</p>}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
