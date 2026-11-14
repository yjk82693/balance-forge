import type { MatchResult, PatchProposal, Report, ReportRow } from "./contract";
import { fixtureMatchConfig, fixturePatch } from "./fixtures";
import { mockTimeline } from "./replayGen";
import { mockReport } from "./mockReport";
import { isProgressMsg, mockProgress, type ProgressMsg } from "./progress";
import { runFromFull } from "./fullRun";
import type { HpTimeline } from "./replaySource";
import { reportFromResults, type RunInfo } from "./reportFromResults";
import { createTransport } from "../mock/transport";
import { isMockMode } from "../mock/types";

export type PatchOrigin = "gemini" | "grok" | "fallback" | "fake" | "manual";
export type VerdictKind = "accepted" | "rejected" | "inconclusive";

export interface Change {
  path: string;
  label?: string;
  old?: number;
  new: number;
}

export interface Proposal {
  patch: PatchProposal;
  /** optional: field-level old -> new values; without it the UI shows the new values only */
  changes?: Change[];
  origin: PatchOrigin;
  validation: { ok: boolean; errors: string[] };
}

export interface Verdict {
  verdict: VerdictKind;
  reasons: string[];
}

/** What the dashboard needs from POST /v1/playtest/run. Only `baseline` is required. */
export interface PlaytestRun {
  baseline: Report;
  proposal?: Proposal;
  patched?: Report;
  verdict?: Verdict;
  /** id of the run, when the server gave one */
  runId?: string;
  /** GET /v1/replay/:matchId for one finished bot match: the stored seed and accepted inputs, not views */
  replay?: ReplayInfo;
  /** client-side flag: data came from fixtures (?mock=1), not from a run */
  sample?: boolean;
}

/** Summary of GET /v1/replay/:matchId ({matchId, seed, config, frames, finalStateHash}). */
export interface ReplayInfo {
  matchId: string;
  seed?: number;
  frames?: number;
  finalStateHash?: string;
  /** from the analysis: HP over time for the baseline data and the patched data (see lib/replaySource.ts) */
  timeline?: HpTimeline;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "server" | "shape",
  ) {
    super(message);
  }
}

const isRow = (r: unknown): r is ReportRow => {
  const row = r as ReportRow;
  return (
    !!row &&
    typeof row.dimension === "string" &&
    Number.isFinite(row.wins) &&
    Number.isFinite(row.games) &&
    row.games >= 0 &&
    row.wins >= 0 &&
    row.wins <= row.games
  );
};

/** Drops rows with impossible counts (wins > games, NaN, negatives) so charts never draw nonsense. */
const cleanReport = (r: Report): Report => ({ ...r, rows: r.rows.filter(isRow) });

/**
 * Real mode: listen to the `playtest.progress` topic while a run is in flight.
 * Mock mode feeds progress from runPlaytest itself.
 */
export function subscribeProgress(onMsg: (p: ProgressMsg) => void): () => void {
  if (isMockMode()) return () => {};
  const t = createTransport("observer");
  const off = t.subscribe((env) => {
    if (env.type !== "playtest.progress") return;
    if (isProgressMsg(env.payload)) onMsg(env.payload);
  });
  return () => {
    off();
    t.close();
  };
}

export async function runPlaytest(
  matches = 1000,
  signal?: AbortSignal,
  onProgress?: (p: ProgressMsg) => void,
): Promise<PlaytestRun> {
  if (isMockMode()) {
    // Baseline run, then the holdout run on the patched data, like the real /full endpoint.
    await playMockPhase(mockReport("broken"), "baseline", onProgress, signal);
    await playMockPhase(mockReport("patched"), "holdout", onProgress, signal);
    return {
      sample: true,
      baseline: mockReport("broken"),
      patched: mockReport("patched"),
      proposal: {
        patch: fixturePatch,
        origin: "fake",
        changes: [{ path: "/moves/1/power", label: "Bari · Spirit arrow power", old: 100, new: 72 }],
        validation: { ok: true, errors: [] },
      },
      verdict: { verdict: "accepted", reasons: ["sample verdict for the fixtures; not computed"] },
      // ?replay=timeline shows the HP-timeline replay path without a server
      replay: new URLSearchParams(location.search).get("replay") === "timeline"
        ? { matchId: "mock-match", timeline: mockTimeline(fixtureMatchConfig.seed, ["bari", "real_armor"]) }
        : undefined,
    };
  }
  return (await runFullPlaytest(signal)) ?? runRealPlaytest(matches, signal);
}

/**
 * POST /v1/playtest/full {gameId, roster: true}: baseline run, proposal, validation, holdout run on the patched data
 * and a verdict, in one request (progress streams over /ws meanwhile). Returns null when the server has no such
 * endpoint (404/405), so the caller can fall back to the plain bot run.
 */
async function runFullPlaytest(signal?: AbortSignal): Promise<PlaytestRun | null> {
  let res: Response;
  try {
    res = await fetch("/v1/playtest/full", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "hero_arena", roster: true }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Couldn't reach the server.", "network");
  }
  if (res.status === 404 || res.status === 405) return null;
  if (!res.ok) return failFrom(res);
  const run = runFromFull(await readJson<unknown>(res, "run reply"));
  if (!run) throw new ApiError("The server's reply had no report.", "shape");
  return run;
}

function playMockPhase(
  report: Report,
  phase: "baseline" | "holdout",
  onProgress?: (p: ProgressMsg) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stop = mockProgress(
      report,
      (p) => {
        onProgress?.(p);
        if (p.matchesDone >= p.totalMatches) resolve();
      },
      { phase, steps: phase === "baseline" ? 40 : 20 },
    );
    signal?.addEventListener("abort", () => {
      stop();
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

const MESSAGES: Record<string, string> = {
  RATE_LIMITED: "Another run is already going.",
  INVALID_SCHEMA: "The server didn't accept the request.",
};

async function readJson<T>(res: Response, what: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`The server's ${what} wasn't JSON.`, "shape");
  }
}

async function failFrom(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  throw new ApiError(MESSAGES[body.code ?? ""] ?? `The server answered ${res.status}.`, "server");
}

/** POST /v1/playtest/run, then GET the returned resultsPath and build the report from the match results. */
async function runRealPlaytest(matches: number, signal?: AbortSignal): Promise<PlaytestRun> {
  const get = async (path: string, init?: RequestInit) => {
    try {
      return await fetch(path, { ...init, signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError("Couldn't reach the server.", "network");
    }
  };
  const res = await get("/v1/playtest/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "hero_arena", pairs: Math.max(1, Math.round(matches / 2)) }),
  });
  if (!res.ok) return failFrom(res);
  const info = await readJson<RunInfo>(res, "run reply");
  if (typeof info?.resultsPath !== "string") throw new ApiError("The server's reply had no results path.", "shape");
  const resultsRes = await get(info.resultsPath);
  if (!resultsRes.ok) return failFrom(resultsRes);
  const results = await readJson<MatchResult[]>(resultsRes, "results");
  if (!Array.isArray(results) || results.length === 0) throw new ApiError("The run returned no matches.", "shape");
  const replay = await fetchReplayInfo(results[0].matchId, signal);
  return { baseline: cleanReport(reportFromResults(results, info)), replay };
}

/** The stored replay of one match; absent (not an error) if the server has none or answers oddly. */
async function fetchReplayInfo(matchId: string, signal?: AbortSignal): Promise<ReplayInfo | undefined> {
  try {
    const res = await fetch(`/v1/replay/${encodeURIComponent(matchId)}`, { signal });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { seed?: unknown; frames?: unknown; finalStateHash?: unknown };
    if (!Number.isInteger(body.seed) || !Array.isArray(body.frames)) return undefined;
    return {
      matchId,
      seed: body.seed as number,
      frames: body.frames.length,
      finalStateHash: String(body.finalStateHash ?? ""),
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return undefined;
  }
}
