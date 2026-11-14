import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, runBotsOnVersion, subscribeProgress, type PlaytestRun } from "../lib/api";
import { ResultCard } from "../components/ResultCard";
import { FitStage } from "../components/FitStage";
import { TopBar } from "../components/TopBar";
import { rowStats } from "../components/WinRateChart";
import { VERDICT_COPY } from "../lib/dashboardData";
import { originLabel } from "../lib/fullRun";
import { botRows } from "../lib/groups";
import { go } from "../lib/router";
import { pct } from "../lib/stats";
import { useManifest } from "../lib/assets";
import { isMockMode } from "../mock/types";
import {
  approveVersion,
  factsFromVersion,
  fetchVersion,
  fetchVersions,
  fieldText,
  layoutRows,
  loadRecordedVersions,
  makeCurrent,
  matchupName,
  runAutoBalance,
  sampleVersions,
  shortHash,
  type Row,
  type VersionDetail,
  type VersionList,
  type VersionRecord,
} from "../lib/versions";

type Source = "live run" | "recorded" | "sample data";
type Busy = null | "balance" | "bots" | "current" | "approve";

/** The record with the server's diff against its parent in place of its own change list, when there is one. */
const withDiff = (v: VersionRecord, d?: VersionDetail): VersionRecord => (d ? { ...v, changes: d.diff } : v);
const originName = (v: VersionRecord) => (v.origin === "base" ? "base" : originLabel(v.origin));
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

/** Where the history comes from: the server, else the stored file, else (?mock=1) the sample. */
async function loadHistory(): Promise<{ list: VersionList | null; source: Source }> {
  if (isMockMode()) return { list: sampleVersions(), source: "sample data" };
  try {
    const live = await fetchVersions();
    if (live) return { list: live, source: "live run" };
  } catch {
    /* no server: fall through to the stored history */
  }
  return { list: await loadRecordedVersions().catch(() => null), source: "recorded" };
}

interface RowProps {
  row: Row;
  selected: boolean;
  current: boolean;
  onPick: () => void;
}

function RowButton({ row, selected, current, onPick }: RowProps) {
  const { record: v } = row;
  const t = v.target;
  return (
    <li style={{ marginLeft: row.lane * 24 }}>
      <button className={`version-row${selected ? " on" : ""}`} onClick={onPick} aria-pressed={selected}>
        <span className="version-hash">{shortHash(v.dataHash)}</span>
        <span className="badge origin">{v.origin === "base" ? "base" : originLabel(v.origin)}</span>
        {current && <span className="badge after">current</span>}
        {!v.approved && <span className="badge before">candidate versions — not shipped</span>}
        <span className="version-fields small">
          {v.changes.length ? v.changes.slice(0, 2).map(fieldText).join(" · ") : "The shipped data"}
        </span>
        {t && (
          <span className="small">
            {matchupName(t.matchup)} {pct(t.before.rate)}% → {pct(t.after.rate)}%
          </span>
        )}
        {v.verdict && (
          <span className={`status ${VERDICT_COPY[v.verdict.verdict].cls}`}>
            <span className="dot" />
            {VERDICT_COPY[v.verdict.verdict].glyph}
            {VERDICT_COPY[v.verdict.verdict].label}
          </span>
        )}
      </button>
    </li>
  );
}

/** What the bots measured on this version, for the matchup the version was about. */
function BotResult({ run, target }: { run: PlaytestRun; target?: string }) {
  const stats = botRows(run.baseline.rows).map(rowStats);
  const s = stats.find((x) => x.row.dimension === target) ?? stats[0];
  if (!s) return <p className="small text-2">The run returned no matchups.</p>;
  return (
    <p className="small">
      Bots on this version: {matchupName(s.row.dimension)} <strong>{pct(s.rate)}%</strong>{" "}
      (95% CI {pct(s.lo)}–{pct(s.hi)}%), {s.row.games.toLocaleString("en-US")} games
    </p>
  );
}

export function Versions() {
  useManifest();
  const [list, setList] = useState<VersionList | null>(null);
  const [source, setSource] = useState<Source>("recorded");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState(1);
  const [approval, setApproval] = useState(true);
  const [botRuns, setBotRuns] = useState<Record<string, PlaytestRun>>({});
  const [details, setDetails] = useState<Record<string, VersionDetail>>({});
  const [roundText, setRoundText] = useState("");

  useEffect(() => {
    let alive = true;
    loadHistory().then((h) => {
      if (!alive) return;
      setList(h.list);
      setSource(h.source);
      setSelected(h.list?.currentHash ?? h.list?.versions[0]?.dataHash ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The server's own diff against the parent, when it has one for the selected version.
  useEffect(() => {
    if (!selected || source !== "live run" || details[selected]) return;
    fetchVersion(selected)
      .then((d) => d && setDetails((all) => ({ ...all, [selected]: d })))
      .catch(() => undefined);
  }, [selected, source, details]);

  // While auto-balance runs, the server's progress says which round and phase it is in.
  useEffect(() => {
    if (busy !== "balance") return setRoundText("");
    return subscribeProgress((p) => {
      const round = p.round ? `Round ${p.round}${p.rounds ? ` of ${p.rounds}` : ""}` : "";
      setRoundText([round, p.phase].filter(Boolean).join(" · "));
    });
  }, [busy]);

  const rows = useMemo(() => layoutRows(list?.versions ?? []), [list]);
  const record = list?.versions.find((v) => v.dataHash === selected);
  const parent = record?.parentHash ? list?.versions.find((v) => v.dataHash === record.parentHash) : undefined;
  const live = source === "live run";

  const act = useCallback(async (kind: Exclude<Busy, null>, job: () => Promise<VersionList | null | void>) => {
    setBusy(kind);
    setError(null);
    try {
      const next = await job();
      if (next === null) setError("This server doesn't support that yet.");
      else if (next) {
        setList(next);
        const first = next.versions[0]?.dataHash ?? null;
        setSelected((cur) => (next.versions.some((v) => v.dataHash === cur) ? cur : first));
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const balance = (fromHash?: string) => act("balance", () => runAutoBalance({ rounds, approval, fromHash }));
  const runBots = (v: VersionRecord) =>
    act("bots", async () => {
      const run = await runBotsOnVersion(v.dataHash);
      setBotRuns((all) => ({ ...all, [v.dataHash]: run }));
    });
  const needsServer = live ? "" : "Needs the live server.";

  return (
    <FitStage>
      <div className="screen versions">
        <TopBar>
          <a className="link-back" href="#/dashboard">
            ← Dashboard
          </a>
          <span className="eyebrow" style={{ color: "var(--game-arena)" }}>
            HERO ARENA
          </span>
          <span className="small text-2">Data versions</span>
          <span className="spacer" />
          <span className={`badge${live ? "" : " recorded"}`}>{source}</span>
        </TopBar>
        <main className="versions-grid">
          <section className="panel" aria-labelledby="history-title" aria-busy={loading || busy !== null}>
            <div className="panel-head">
              <span id="history-title" className="eyebrow">
                History
              </span>
              <span className="meta">newest first</span>
            </div>
            <div className="balance-bar">
              <div className="seg" role="group" aria-label="Rounds">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    aria-pressed={rounds === n}
                    className={rounds === n ? "on" : ""}
                    onClick={() => setRounds(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <label
                className="small toggle"
                title="On: an accepted version ships by itself. Off: new versions stay candidates until approved."
              >
                <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Approval
              </label>
              <button
                className="btn primary"
                aria-disabled={!live || busy !== null}
                title={needsServer}
                aria-busy={busy === "balance"}
                onClick={() => live && !busy && balance(list?.currentHash)}
              >
                {busy === "balance" ? `Balancing…${roundText ? ` ${roundText}` : ""}` : "Auto-balance"}
              </button>
            </div>
            {!approval && (
              <p className="caption">Approval is off: new versions are candidate versions — not shipped.</p>
            )}
            {error && (
              <p className="err small" role="alert">
                {error}
              </p>
            )}
            {loading && <div className="skeleton" aria-hidden="true" />}
            {!loading && rows.length === 0 && (
              <div className="empty">
                <p className="h3">No stored versions yet.</p>
                <p className="text-2">Run auto-balance on the live server, or add a stored history file.</p>
              </div>
            )}
            <ul className="version-list">
              {rows.map((r) => (
                <RowButton
                  key={r.record.dataHash}
                  row={r}
                  selected={r.record.dataHash === selected}
                  current={r.record.dataHash === list?.currentHash}
                  onPick={() => setSelected(r.record.dataHash)}
                />
              ))}
            </ul>
          </section>

          <section aria-label="Selected version">
            {record ? (
              <>
                <ResultCard
                  facts={factsFromVersion(withDiff(record, details[record.dataHash]), source)}
                  title="Version"
                >
                  <p className="caption">
                    {parent
                      ? `Changes compared with ${shortHash(parent.dataHash)} (${originName(parent)})`
                      : "The root version: no parent to compare with."}
                    {record.note ? ` · ${record.note}` : ""}
                  </p>
                </ResultCard>
                {botRuns[record.dataHash] && (
                  <BotResult run={botRuns[record.dataHash]} target={record.target?.matchup} />
                )}
                <div className="version-actions">
                  <button className="btn primary" onClick={() => go(`/lobby/hero_arena?hash=${record.dataHash}`)}>
                    Play this version
                  </button>
                  <button
                    className="btn secondary"
                    aria-disabled={!live || busy !== null}
                    title={needsServer}
                    onClick={() => live && !busy && runBots(record)}
                  >
                    {busy === "bots" ? "Bots are playing…" : "Run bots on this version"}
                  </button>
                  <button
                    className="btn secondary"
                    aria-disabled={!live || busy !== null}
                    title={needsServer}
                    onClick={() => live && !busy && balance(record.dataHash)}
                  >
                    Continue auto-balance from here
                  </button>
                  {!record.approved && (
                    <button
                      className="btn secondary"
                      aria-disabled={!live || busy !== null}
                      title={needsServer || "Ship this candidate version."}
                      onClick={() => live && !busy && act("approve", () => approveVersion(record.dataHash))}
                    >
                      Approve
                    </button>
                  )}
                  <button
                    className="btn secondary"
                    aria-disabled={!live || busy !== null || record.dataHash === list?.currentHash}
                    title={needsServer || "Select this older version as the current one. Nothing is deleted."}
                    onClick={() => live && !busy && act("current", () => makeCurrent(record.dataHash))}
                  >
                    Make current
                  </button>
                </div>
              </>
            ) : (
              !loading && <p className="text-2">Pick a version to see what changed.</p>
            )}
          </section>
        </main>
      </div>
    </FitStage>
  );
}
