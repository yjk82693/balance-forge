import type { PlaytestRun } from "../lib/api";
import type { Report } from "../lib/contract";
import { VERDICT_COPY, fmtSeconds, headlineFor, n, outliersFirst, pickTargetDimension } from "../lib/dashboardData";
import type { LiveState } from "../lib/useRunner";
import { heroName } from "../lib/heroes";
import { pct } from "../lib/stats";
import { PatchCompare } from "./PatchCompare";
import { WinRateChart, rowStats } from "./WinRateChart";

function RecordedBadges({ report, sample }: { report: Report; sample?: boolean }) {
  const parts = [`${n(report.validMatches)} matches`];
  if (typeof report.elapsedMs === "number") parts.push(fmtSeconds(report.elapsedMs));
  const text = parts.join(" · ");
  return (
    <>
      {report.recorded || sample ? (
        <span className="badge recorded">recorded · {text}</span>
      ) : (
        <span className="badge">{text}</span>
      )}
      {sample && <span className="badge">sample data</span>}
    </>
  );
}

interface Props {
  run: PlaytestRun | null;
  busy: boolean;
  live: LiveState;
  error: string | null;
  notice: string | null;
  showPatched: boolean;
  onRun: () => void;
}

/** Right-hand panel: live counter while bots play, then the report, patch comparison and verdict. */
export function ReportPanel({ run, busy, live, error, notice, showPatched, onRun }: Props) {
  const report = run ? (showPatched && run.patched ? run.patched : run.baseline) : null;
  return (
    <section className="panel report" aria-labelledby="report-title" aria-busy={busy}>
      <div className="panel-head">
        <span id="report-title" className="eyebrow">
          Balance report
        </span>
        {report && <span className="meta">n = {n(report.validMatches)}</span>}
      </div>

      {!busy && notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="btn secondary" onClick={onRun}>
            Try live again
          </button>
        </div>
      )}
      {!busy && error && (
        <div className="err" role="alert">
          <p className="small">{error} Check that the server is running, then try again.</p>
          <button className="btn secondary" onClick={onRun}>
            Try again
          </button>
        </div>
      )}

      {busy && <LiveReport live={live} />}

      {!busy && !run && !error && (
        <div className="empty">
          <p className="h3">No runs yet.</p>
          <p className="text-2">Let the bots play to see a report.</p>
        </div>
      )}

      {!busy && run && report && <FinishedReport run={run} report={report} showPatched={showPatched} />}
    </section>
  );
}

function LiveReport({ live }: { live: LiveState }) {
  return (
    <>
      <h1 className="h2">Bots are playing…</h1>
      <p className="kpi">
        {n(live.done)} / {n(live.total)} matches
      </p>
      <hr className="divider" />
      {live.rows ? <WinRateChart rows={live.rows} dense /> : <div className="skeleton" aria-hidden="true" />}
    </>
  );
}

function FinishedReport({ run, report, showPatched }: { run: PlaytestRun; report: Report; showPatched: boolean }) {
  if (report.rows.length === 0) {
    return (
      <div className="empty">
        <p className="h3">The report has no matchups.</p>
        <p className="text-2">Run the bots again; a report needs at least one finished match.</p>
      </div>
    );
  }
  const stats = report.rows.map(rowStats);
  const baseStats = run.baseline.rows.map(rowStats);
  const targetDim = pickTargetDimension(baseStats);
  const sorted = outliersFirst(stats);
  const shown = stats.find((s) => s.row.dimension === targetDim) ?? sorted[0];
  const base = baseStats.find((s) => s.row.dimension === targetDim) ?? baseStats[0];
  const elapsed = report.elapsedMs != null ? ` · ${fmtSeconds(report.elapsedMs)}` : "";
  const verdict = run.verdict ? VERDICT_COPY[run.verdict.verdict] : null;
  return (
    <>
      <h1 className="h2">{headlineFor(shown)}</h1>
      <p className="kpi">
        {pct(shown.rate)}% · {n(report.validMatches)} games{elapsed}
      </p>
      <p className="report-meta">
        <RecordedBadges report={report} sample={run.sample} />
        <span className="caption">
          {report.seedSetId} · {report.draws} draws · {report.rows.length} matchups
        </span>
      </p>
      <hr className="divider" />
      <WinRateChart rows={sorted.map((s) => s.row)} dense />

      {run.patched && (
        <>
          <hr className="divider" />
          <PatchCompare before={run.baseline} after={run.patched} showAfter={showPatched} />
        </>
      )}
      {run.verdict && verdict && (
        <p className="verdict" role="status">
          <span className={`status ${verdict.cls}`}>
            <span className="dot" />
            {verdict.glyph}
            {verdict.label}
          </span>
          {run.verdict.reasons[0] && <span className="caption">{run.verdict.reasons[0]}</span>}
        </p>
      )}
      {showPatched && (
        <p className="caption">
          {heroName(shown.matchup.a)} {pct(base.rate)}% → {pct(shown.rate)}% · 95% CI {pct(shown.lo)}–
          {pct(shown.hi)}%
        </p>
      )}
      {run.proposal && !run.patched && <p className="caption">Run the patched data to compare.</p>}
    </>
  );
}
