import type { MatchResult, PatchProposal, Report, ReportRow } from "./contract";
import { fixturePatch } from "./fixtures";
import { mockReport } from "./mockReport";
import { isProgressMsg, mockProgress, type ProgressMsg } from "./progress";
import { reportFromResults, type RunInfo } from "./reportFromResults";
import { createTransport } from "../mock/transport";
import { isMockMode } from "../mock/types";

export type PatchOrigin = "gemini" | "fallback" | "manual";
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
  /** matchId of one finished bot match, for GET /v1/replay/:matchId */
  replayMatchId?: string;
  /** client-side flag: data came from fixtures (?mock=1), not from a run */
  sample?: boolean;
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
    const final = mockReport("broken");
    await new Promise<void>((resolve, reject) => {
      const stop = mockProgress(final, (p) => {
        onProgress?.(p);
        if (p.matchesDone >= p.totalMatches) resolve();
      });
      signal?.addEventListener("abort", () => {
        stop();
        reject(new DOMException("aborted", "AbortError"));
      });
    });
    return {
      sample: true,
      baseline: mockReport("broken"),
      patched: mockReport("patched"),
      proposal: {
        patch: fixturePatch,
        origin: "manual",
        changes: [{ path: "/moves/1/power", label: "Bari · Spirit arrow power", old: 100, new: 72 }],
        validation: { ok: true, errors: [] },
      },
      verdict: { verdict: "accepted", reasons: ["sample verdict for the fixtures; not computed"] },
    };
  }
  return runRealPlaytest(matches, signal);
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
  return { baseline: cleanReport(reportFromResults(results, info)), replayMatchId: results[0].matchId };
}
