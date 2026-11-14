import type { PlaytestRun } from "../lib/api";
import type { Report, ReportRow } from "../lib/contract";
import { botRows, humanRows } from "../lib/groups";
import { VERDICT_COPY, fmtSeconds, headlineFor, n, outliersFirst, pickTargetDimension } from "../lib/dashboardData";
import type { LiveState } from "../lib/useRunner";
import { heroName } from "../lib/heroes";
import { pct } from "../lib/stats";
import { phaseName } from "./LivePanel";
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
  /** seconds since the run started */
  elapsed?: number;
  notice: string | null;
  /** the stored roster run: the all-matchups table when the live run covers one matchup only */
  roster?: PlaytestRun | null;
  showPatched: boolean;
  onRun: () => void;
}

/** Right-hand panel: live counter while bots play, then the report, patch comparison and verdict. */
export function ReportPanel({ run, busy, live, error, notice, elapsed = 0, roster, showPatched, onRun }: Props) {
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
          <p className="small">{error} Try again when you're ready.</p>
          <button className="btn secondary" onClick={onRun}>
            Try again
          </button>
        </div>
      )}

      {busy && <LiveReport live={live} elapsed={elapsed} />}

      {!busy && !run && !error && (
        <div className="empty">
          <p className="h3">No runs yet.</p>
          <p className="text-2">Let the bots play to see a report.</p>
        </div>
      )}

      {!busy && run && report && (
        <FinishedReport run={run} report={report} showPatched={showPatched} roster={roster ?? null} />
      )}
    </section>
  );
}

/** Human matches are their own group under the bot chart; their names are labels, not heroes. */
function HumanGroup({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="human-group">
      <p className="eyebrow" style={{ color: "var(--text-2)" }}>
        Human matches
      </p>
      <WinRateChart rows={rows} dense />
    </div>
  );
}

/** A run with fewer matchups than this is not a roster run. */
const ROSTER_MIN_ROWS = 5;

/** At most this many matchups are repeated in the holdout strip (the same ones the baseline shows as most lopsided). */
const HOLDOUT_ROWS = 3;

/** The holdout run's own strip: its counter and the baseline's most lopsided matchups, on the patched data. */
function HoldoutStrip({ live }: { live: LiveState }) {
  const holdout = live.holdout;
  if (!holdout) return null;
  const lead = outliersFirst(botRows(live.rows ?? []).map(rowStats)).slice(0, HOLDOUT_ROWS);
  const dims = new Set(lead.map((s) => s.row.dimension));
  const rows = holdout.rows.filter((r) => dims.has(r.dimension));
  return (
    <section className="holdout-strip" aria-label="Holdout on the patched data">
      <p className="eyebrow">
        Holdout on the patched data · {n(holdout.done)} / {holdout.total ? n(holdout.total) : "…"} matches
      </p>
      {rows.length > 0 ? <WinRateChart rows={rows} dense /> : <div className="skeleton" aria-hidden="true" />}
      <hr className="divider" />
      <p className="eyebrow">Baseline, finished</p>
    </section>
  );
}

function LiveReport({ live, elapsed }: { live: LiveState; elapsed: number }) {
  return (
    <>
      <h1 className="h2">Bots are playing…</h1>
      <p className="eyebrow">{live.phase ? phaseName(live.phase) : "Waiting for the first results"} · {elapsed} s</p>
      <p className="kpi">
        {n(live.done)} / {live.total ? n(live.total) : "…"} matches
      </p>
      <hr className="divider" />
      <HoldoutStrip live={live} />
      {live.rows ? <WinRateChart rows={live.rows} dense /> : <div className="skeleton" aria-hidden="true" />}
    </>
  );
}

interface FinishedProps {
  run: PlaytestRun;
  report: Report;
  showPatched: boolean;
  roster: PlaytestRun | null;
}

/** A live run covers one matchup; the table of all of them is the stored roster report, labelled as such. */
function RecordedRoster({ roster }: { roster: PlaytestRun }) {
  const rows = outliersFirst(botRows(roster.baseline.rows).map(rowStats)).map((s) => s.row);
  return (
    <div className="human-group">
      <p className="eyebrow" style={{ color: "var(--text-2)" }}>
        All matchups <span className="badge recorded">recorded</span>
      </p>
      <WinRateChart rows={rows} dense />
    </div>
  );
}

function FinishedReport({ run, report, showPatched, roster }: FinishedProps) {
  const bots = botRows(report.rows);
  const humans = humanRows(report.rows);
  if (bots.length === 0) {
    return (
      <div className="empty">
        <p className="h3">The report has no matchups.</p>
        <p className="text-2">Run the bots again; a report needs at least one finished match.</p>
        {humans.length > 0 && <HumanGroup rows={humans} />}
      </div>
    );
  }
  const stats = bots.map(rowStats);
  const baseStats = botRows(run.baseline.rows).map(rowStats);
  const targetDim = pickTargetDimension(baseStats);
  const sorted = outliersFirst(stats);
  const shown = stats.find((s) => s.row.dimension === targetDim);
  const base = baseStats.find((s) => s.row.dimension === targetDim);
  const elapsed = report.elapsedMs != null ? ` · ${fmtSeconds(report.elapsedMs)}` : "";
  const verdict = run.verdict ? VERDICT_COPY[run.verdict.verdict] : null;
  return (
    <>
      <h1 className="h2">{headlineFor(shown)}</h1>
      <p className="kpi">
        {shown ? `${pct(shown.rate)}% · ` : ""}
        {n(report.validMatches)} games{elapsed}
      </p>
      <p className="report-meta">
        <RecordedBadges report={report} sample={run.sample} />
        <span className="caption">
          {report.seedSetId} · {report.draws} draws · {bots.length} matchups
        </span>
      </p>
      <hr className="divider" />
      <WinRateChart rows={sorted.map((s) => s.row)} dense />
      {humans.length > 0 && <HumanGroup rows={humans} />}
      {bots.length < ROSTER_MIN_ROWS && roster && botRows(roster.baseline.rows).length > bots.length && (
        <RecordedRoster roster={roster} />
      )}

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
      {showPatched && shown && base && (
        <p className="caption">
          {heroName(shown.matchup.a)} {pct(base.rate)}% → {pct(shown.rate)}% · 95% CI {pct(shown.lo)}–
          {pct(shown.hi)}%
        </p>
      )}
      {run.proposal && !run.patched && <p className="caption">Run the patched data to compare.</p>}
    </>
  );
}
