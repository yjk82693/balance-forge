import { useEffect, useRef, useState } from "react";
import { ApiError, runPlaytest, subscribeProgress, type PlaytestRun } from "./api";
import type { ReportRow } from "./contract";
import { MATCHES, loadRun, saveRun } from "./dashboardData";
import { isMockMode } from "../mock/types";
import { mockProgress, toRows, type ProgressMsg } from "./progress";
import { loadRecordedRun } from "./recorded";

export interface LiveState {
  done: number;
  total: number;
  /** cumulative rows while bots play; null once the stored report takes over */
  rows: ReportRow[] | null;
  /** which run is going: the baseline, then the holdout on the patched data */
  phase?: "baseline" | "holdout";
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
export function useRunner() {
  const mock = isMockMode();
  const [run, setRun] = useState<PlaytestRun | null>(() => (mock ? null : loadRun()));
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LiveState>({ done: 0, total: 0, rows: null });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const finish = (result: PlaytestRun) => {
    setRun(result);
    // From here the numbers come from the report itself, not from the progress stream.
    setLive({ done: result.baseline.validMatches, total: result.baseline.validMatches, rows: null });
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setLive({ done: 0, total: 0, rows: null });
    const controller = new AbortController();
    abort.current = controller;
    const onProgress = (p: ProgressMsg) =>
      setLive({ done: p.matchesDone, total: p.totalMatches, rows: toRows(p), phase: p.phase });
    const stopListening = subscribeProgress(onProgress);
    try {
      const result = await runPlaytest(MATCHES, controller.signal, onProgress);
      finish(result);
      if (!mock) saveRun(result);
    } catch (e) {
      if (isAbort(e)) return;
      const why = e instanceof ApiError ? e.message : "Something went wrong.";
      try {
        const stored = await loadRecordedRun();
        await playStoredRun(stored, onProgress, controller.signal);
        finish(stored);
        setNotice(`${why} Showing the stored run instead.`);
      } catch (e2) {
        if (!isAbort(e2)) setError(why);
      }
    } finally {
      stopListening();
      setBusy(false);
    }
  };

  return { run, busy, live, error, notice, start };
}
