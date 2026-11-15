import { useMemo, type ReactNode } from "react";
import { VERDICT_COPY } from "../lib/dashboardData";
import { originLabel } from "../lib/fullRun";
import { shownPhase } from "../lib/runPhase";
import { fallbackNote } from "../lib/resultCard";
import { pct } from "../lib/stats";
import { outcomeClass, outcomeWords, targetWords, waveChangeLabel, waveName, type WaveRow } from "../lib/tentacleDash";
import { useRunner } from "../lib/useRunner";
import { isMockMode } from "../mock/types";
import { Collapsible } from "./Collapsible";
import { EmptyResult } from "./EmptyResult";
import { FitStage } from "./FitStage";
import { GameSwitch } from "./GameSwitch";
import { PatchColumn } from "./ResultCard";
import { ResultSkeleton, phaseWords } from "./ResultSkeleton";
import { RunMenu } from "./RunMenu";
import { SinkChip } from "./SinkChip";
import { TopBar } from "./TopBar";
import { Plot } from "./WinRateChart";

const MARGIN = 0.1; // a wave is flagged when its whole interval is below the target minus this
const place = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;
const rate = (x: number | null) => (x === null ? "—" : `${pct(x)}%`);

/** One wave on a 0-100% track: the clear rate with its interval, the intended band, and the patched rate as a ring. */
function WaveBar({ row, after }: { row: WaveRow; after?: WaveRow }) {
  const target = row.target ?? 0.6;
  const band: [number, number] = [Math.max(0, target - MARGIN), Math.min(1, target + MARGIN)];
  const few = row.reached < 30;
  return (
    <div className={`viz-row${row.outlier ? " outlier" : ""}`}>
      <div className="viz-label">
        <span className="small viz-name">{waveName(row.wave)}</span>
        {row.outlier && <span className="badge outlier">▲ Too hard</span>}
        <span className="caption intended">target {pct(target)}%</span>
      </div>
      <Plot band={band}>
        <div
          className={`viz-bar${row.outlier ? " warn" : ""}${few ? " small-n" : ""}`}
          style={{ width: place(row.clearRate ?? 0) }}
        />
        {row.ci95 && !few && (
          <div className="viz-ci" style={{ left: place(row.ci95[0]), width: place(row.ci95[1] - row.ci95[0]) }}>
            <i className="cap l" />
            <i className="cap r" />
          </div>
        )}
        {after?.clearRate != null && (
          <span className="rate-dot" style={{ left: place(after.clearRate) }} title="after the patch" />
        )}
      </Plot>
      <span className="viz-value small">{few ? "Few runs" : rate(row.clearRate)}</span>
    </div>
  );
}

function WaveTable({ rows, after }: { rows: WaveRow[]; after: WaveRow[] }) {
  return (
    <table className="card-grid wave-table">
      <thead>
        <tr>
          <th className="small text-2">Section</th>
          <th className="small text-2">Reached</th>
          <th className="small text-2">Cleared</th>
          <th className="small text-2">Clear rate</th>
          <th className="small text-2">Died here</th>
          {after.length > 0 && <th className="small text-2">After the patch</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const a = after.find((x) => x.wave === r.wave);
          return (
            <tr key={r.wave} className={r.outlier ? "card-flag" : undefined}>
              <td className="small">{waveName(r.wave)}</td>
              <td className="small">{r.reached}</td>
              <td className="small">{r.cleared}</td>
              <td className="small" title={r.ci95 ? `95% CI ${pct(r.ci95[0])}–${pct(r.ci95[1])}%` : undefined}>
                {rate(r.clearRate)}
                {r.target !== null && <span className="small text-2"> of {pct(r.target)}% target</span>}
              </td>
              <td className="small">{r.deaths}</td>
              {after.length > 0 && <td className="small">{a ? rate(a.clearRate) : "—"}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface Props {
  theme: "dark" | "light";
  onTheme: () => void;
}

/** The Sepia Tentacle Run dashboard: the flagged wave, the per-wave table, the patch and the verdict. */
export function TentacleDashboard({ theme, onTheme }: Props) {
  const mock = isMockMode();
  const { run, busy, live, error, notice, elapsed, start } = useRunner("tentacle_run");
  const go = () => void start(undefined, false, undefined);
  const result = run?.tentacle ?? null;
  const flagged = result?.flagged ?? null;
  const verdict =
    run?.verdict && !run.fair ? { ...VERDICT_COPY[run.verdict.verdict], reasons: run.verdict.reasons } : null;
  const note = run ? fallbackNote(run) : null;
  const patch = useMemo(
    () =>
      run?.proposal && !run.fair
        ? run.proposal.changes?.map((c) => ({
            field: waveChangeLabel(c.path) ?? c.label ?? c.path,
            path: c.path,
            old: c.old,
            next: c.new,
            rationale: run.proposal!.patch.rationale,
            origin: originLabel(run.proposal!.origin),
            valid: run.proposal!.validation.ok,
            errors: run.proposal!.validation.errors,
          })) ?? []
        : [],
    [run],
  );
  const source = !run
    ? mock
      ? "sample data"
      : ""
    : run.sample
      ? "sample data"
      : run.baseline.recorded
        ? "recorded"
        : "live run";
  const status: ReactNode = source && (
    <span className={`badge status-chip${source === "live run" ? " live" : " recorded"}`}>
      {source}
      {result ? ` · ${result.runs} runs` : ""}
    </span>
  );
  const flaggedBand = result?.targets.find((t) => t.wave === flagged?.wave)?.band ?? null;
  const target = flagged?.target ?? 0.6;
  const band: [number, number] = [Math.max(0, target - MARGIN), Math.min(1, target + MARGIN)];
  const sections: { id: string; title: string; note?: string; body: ReactNode; open?: boolean }[] = result
    ? [
        {
          id: "waves",
          title: "Sections",
          note: `${result.waves.length}`,
          open: true,
          body: <WaveTable rows={result.waves} after={result.patchedWaves} />,
        },
        {
          id: "patch",
          title: "Patch",
          note: patch.length ? `${patch.length} change${patch.length > 1 ? "s" : ""}` : undefined,
          open: true,
          body: patch.length ? (
            <PatchColumn patch={patch} fallbackNote={note} />
          ) : (
            <p className="text-2">No patch for this run.</p>
          ),
        },
        {
          id: "verdict",
          title: "Verdict",
          note: result.targets.length ? String(result.targets.length) : undefined,
          body: (
            <>
              {result.targets.length > 0 ? (
                <ul className="target-rows" aria-label="Per-section verdict">
                  {result.targets.map((t) => (
                    <li key={t.wave} className="target-row">
                      <span className="small">{waveName(t.wave)}</span>
                      <span className="caption">
                        {pct(t.before.rate)}% → {pct(t.after.rate)}%
                        {targetWords(t.band, null) ? ` · ${targetWords(t.band, null)}` : ""}
                      </span>
                      <span className={outcomeClass(t.outcome)}>{outcomeWords(t.outcome)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-2">This verdict has no per-section rows.</p>
              )}
              {(run?.verdict?.reasons ?? []).map((r) => (
                <p key={r} className="small">
                  {r}
                </p>
              ))}
            </>
          ),
        },
      ]
    : [];
  return (
    <FitStage>
      <div className="screen dash2 dash-cards">
        <TopBar>
          <GameSwitch disabled={busy} />
          <span className="spacer" />
          <SinkChip />
          <RunMenu>
            <button className="btn secondary" onClick={onTheme}>
              {theme === "dark" ? "Light theme" : "Dark theme"}
            </button>
            <a className="btn secondary" href="#/versions">
              Versions
            </a>
            <a className="btn secondary" href="#/present">
              Present
            </a>
          </RunMenu>
          <button className="btn primary" onClick={go} aria-busy={busy} aria-disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "Sepia is running…" : "Let the bot run"}
          </button>
        </TopBar>
        <section className="strip" aria-label="Result">
          {busy ? (
            <div className="strip-busy" aria-busy="true" aria-live="polite">
              <p className="strip-mid">{phaseWords(shownPhase(live))}…</p>
              <div className="progress waiting" role="progressbar">
                <span />
              </div>
              <p>{elapsed} s</p>
            </div>
          ) : !result ? (
            <div className="strip-empty">
              <p className="strip-mid">Sepia Tentacle Run</p>
              <p>The section that is too hard, its clear rate against the target and the verdict appear here.</p>
            </div>
          ) : (
            <>
              <div className="strip-who">
                <p className="strip-names">{flagged ? waveName(flagged.wave) : "All sections"}</p>
                <p className="strip-big">{flagged ? `${pct(flagged.clearRate)}%` : rate(result.winRate)}</p>
                <p>
                  {flagged
                    ? `cleared · 95% CI ${flagged.ci95 ? `${pct(flagged.ci95[0])}–${pct(flagged.ci95[1])}%` : "—"}`
                    : "runs won"}{" "}
                  · {result.runs} runs
                </p>
              </div>
              <div className="strip-intent">
                <p className="strip-mid">
                  {flagged
                    ? `${waveName(flagged.wave)} is too hard`
                    : "Every section is within its target"}
                </p>
                {flagged && (
                  <div
                    className="strip-bar"
                    role="img"
                    aria-label={`${pct(flagged.clearRate)}%, target ${pct(target)}%`}
                  >
                    <span
                      className="rate-band"
                      style={{ left: place(band[0]), width: `${(band[1] - band[0]) * 100}%` }}
                    />
                    {flagged.ci95 && (
                      <span
                        className="rate-ci"
                        style={{ left: place(flagged.ci95[0]), width: place(flagged.ci95[1] - flagged.ci95[0]) }}
                      />
                    )}
                    <span className="rate-dot" style={{ left: place(flagged.clearRate) }} />
                  </div>
                )}
                {flagged && <p>{targetWords(flaggedBand, flagged.target)}</p>}
              </div>
              <div className="strip-verdict">
                {verdict ? (
                  <>
                    <p className={`strip-badge status ${verdict.cls}`}>
                      <span className="dot" />
                      {verdict.label}
                    </p>
                    {verdict.reasons[0] && <p>{verdict.reasons[0]}</p>}
                    {note && <p className="strip-fallback">{note}</p>}
                  </>
                ) : run?.fair ? (
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
          <div className="strip-side">{status}</div>
        </section>
        {!busy && notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
          </div>
        )}
        {!busy && error && (
          <div className="err" role="alert">
            <p>{error}</p>
            <button className="btn secondary" onClick={go}>
              Try again
            </button>
          </div>
        )}
        <main className="d2-main d2-split">
          <div className="d2-left">
            {busy ? (
              <ResultSkeleton live={live} elapsed={elapsed} />
            ) : !result ? (
              <EmptyResult onRun={go} />
            ) : (
              sections.map((sec) => (
                <Collapsible key={sec.id} title={sec.title} note={sec.note} defaultOpen={sec.open}>
                  {sec.body}
                </Collapsible>
              ))
            )}
          </div>
          <aside className="d2-right panel" aria-label="Clear rate by section">
            <p className="eyebrow">Clear rate by section</p>
            {result ? (
              <div className="viz dense">
                {result.waves.map((w) => (
                  <WaveBar key={w.wave} row={w} after={result.patchedWaves.find((x) => x.wave === w.wave)} />
                ))}
                <p className="caption viz-foot">
                  Shaded band = the target ±10 points. Whiskers = 95% CI. Dot = the clear rate after the patch.
                </p>
              </div>
            ) : (
              <p className="text-2">The sections appear here once the bot has run.</p>
            )}
          </aside>
        </main>
      </div>
    </FitStage>
  );
}

