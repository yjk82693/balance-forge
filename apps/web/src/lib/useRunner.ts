import { useEffect, useRef, useState } from "react";
import { ApiError, runPlaytest, subscribeProgress, type PlaytestRun } from "./api";
import type { ReportRow } from "./contract";
import { MATCHES, loadRun, saveRun } from "./dashboardData";
import { isMockMode } from "../mock/types";
import { mockProgress, toRows, type ProgressMsg, type RunPhase } from "./progress";
import { loadRecordedRun } from "./recorded";

export interface LiveState {
  done: number;
  total: number;
  /** cumulative rows while bots play; null once the stored report takes over */
  rows: ReportRow[] | null;
  /** which run is going: the baseline, then the holdout on the patched data */
  phase?: RunPhase;
  /** the holdout run's own counter and bars; the baseline numbers above stay frozen once it starts */
  holdout?: { done: number; total: number; rows: ReportRow[] };
  /** the hero diagnosis phase's own counter; it too leaves the baseline table alone */
  diagnose?: { done: number; total: number };
}

/** Folds one progress message into the live state. The holdout phase never touches the baseline table. */
export function foldProgress(prev: LiveState, p: ProgressMsg): LiveState {
  if (p.phase === "diagnose" || p.phase === "probe") {
    return { ...prev, phase: p.phase, diagnose: { done: p.matchesDone, total: p.totalMatches } };
  }
  if (p.phase === "holdout") {
    return { ...prev, phase: "holdout", holdout: { done: p.matchesDone, total: p.totalMatches, rows: toRows(p) } };
  }
  return { done: p.matchesDone, total: p.totalMatches, rows: toRows(p), phase: p.phase };
}

const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";

/** Play the stored run through the same live view; rejects with AbortError if the signal fires. */
function playStoredRun(run: PlaytestRun, onProgress: (p: ProgressMsg) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = mockProgress(
      run.baseline,
      (p) => {
        onProgress(p);
        if (p.matchesDone >= p.totalMatches) resolve();
      },
      { steps: 25, stepMs: 100 },
    );
    signal.addEventListener("abort", () => {
      stop();
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

/** Runs the bot batch, feeds live progress, and falls back to the stored run when the live run fails. */
export function useRunner(game: "hero_arena" | "hero_cards" = "hero_arena") {
  const mock = isMockMode();
  const [run, setRun] = useState<PlaytestRun | null>(() => (mock ? null : loadRun(game)));
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LiveState>({ done: 0, total: 0, rows: null });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // A full roster run takes about a minute. Count seconds so the panel keeps moving between progress messages.
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const finish = (result: PlaytestRun) => {
    setRun(result);
    // From here the numbers come from the report itself, not from the progress stream.
    setLive({ done: result.baseline.validMatches, total: result.baseline.validMatches, rows: null });
  };

  const start = async (heroes?: [string, string], diagnose = false, botPolicy?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setLive({ done: 0, total: 0, rows: null });
    const controller = new AbortController();
    abort.current = controller;
    const onProgress = (p: ProgressMsg) => setLive((prev) => foldProgress(prev, p));
    const stopListening = subscribeProgress(onProgress);
    try {
      const result = await runPlaytest(MATCHES, controller.signal, onProgress, heroes, diagnose, botPolicy, game);
      finish(result);
      if (!mock) saveRun(result);
    } catch (e) {
      if (isAbort(e)) return;
      const why = e instanceof ApiError ? e.message : "Something went wrong.";
      if (e instanceof ApiError && e.keepMatchup) return setError(why); // keep the picked matchup, no stored run
      try {
        if (game === "hero_cards") throw e; // there is no recorded Hero Cards run to fall back to
        const stored = await loadRecordedRun();
        await playStoredRun(stored, onProgress, controller.signal);
        finish(stored);
        setNotice(`${why} Showing the stored run instead.`);
      } catch (e2) {
        const unreachable = e instanceof ApiError && e.kind === "network";
        if (!isAbort(e2)) setError(unreachable ? `${why} Check that the server is running.` : why);
      }
    } finally {
      stopListening();
      setBusy(false);
    }
  };

  /** Swap in the same run judged again (after reanalyze), without a new bot run. */
  const replace = (next: PlaytestRun) => {
    setRun(next);
    if (!mock) saveRun(next);
  };

  return { run, busy, live, error, notice, elapsed, start, replace };
}
