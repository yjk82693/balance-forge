import type { PatchProposal, Report, ReportRow } from "./contract";
import { fixturePatch } from "./fixtures";
import { mockReport } from "./mockReport";
import { mockProgress, type ProgressMsg } from "./progress";
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

const isReport = (r: unknown): r is Report =>
  !!r && typeof r === "object" && Array.isArray((r as Report).rows) && typeof (r as Report).validMatches === "number";

/** Drops rows with impossible counts (wins > games, NaN, negatives) so charts never draw nonsense. */
const cleanReport = (r: Report): Report => ({ ...r, rows: r.rows.filter(isRow) });

const ORIGINS: PatchOrigin[] = ["gemini", "fallback", "manual"];
const VERDICTS: VerdictKind[] = ["accepted", "rejected", "inconclusive"];

/** Accepts the documented shape plus a few obvious aliases; anything else is a "shape" error, never a crash. */
export function normalizeRun(raw: unknown): PlaytestRun {
  const o = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const baseline = o.baseline ?? o.before ?? o.report;
  if (!isReport(baseline)) throw new ApiError("The server's reply had no report.", "shape");
  const patched = o.patched ?? o.after;
  const p = o.proposal ?? (o.patch ? { patch: o.patch, origin: o.origin, validation: o.validation } : undefined);
  const proposal: Proposal | undefined =
    p && p.patch
      ? {
          patch: {
            baseDataHash: String(p.patch.baseDataHash ?? ""),
            replacements: Array.isArray(p.patch.replacements) ? p.patch.replacements : [],
            rationale: String(p.patch.rationale ?? ""),
          } as PatchProposal,
          changes: Array.isArray(p.changes) ? p.changes : undefined,
          origin: ORIGINS.includes(p.origin) ? p.origin : "manual",
          validation: {
            ok: p.validation?.ok !== false && !(p.validation?.errors?.length > 0),
            errors: Array.isArray(p.validation?.errors) ? p.validation.errors.map(String) : [],
          },
        }
      : undefined;
  const v = o.verdict;
  const verdictKind = typeof v === "string" ? v : v?.verdict;
  const verdict: Verdict | undefined = VERDICTS.includes(verdictKind)
    ? { verdict: verdictKind, reasons: Array.isArray(v?.reasons) ? v.reasons.map(String) : [] }
    : undefined;
  return {
    baseline: cleanReport(baseline),
    patched: isReport(patched) ? cleanReport(patched) : undefined,
    proposal,
    verdict,
  };
}

/**
 * Real mode: listen to the `playtest.progress` topic while a run is in flight.
 * Mock mode feeds progress from runPlaytest itself.
 */
export function subscribeProgress(onMsg: (p: ProgressMsg) => void): () => void {
  if (isMockMode()) return () => {};
  const t = createTransport("observer");
  const off = t.subscribe((env) => {
    if (env.type !== "playtest.progress") return;
    const p = env.payload as ProgressMsg;
    if (typeof p?.done === "number" && typeof p?.total === "number") onMsg(p);
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
        if (p.done >= p.total) resolve();
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
  let res: Response;
  try {
    res = await fetch("/v1/playtest/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "hero_arena", matches }),
      signal,
    });
  } catch {
    throw new ApiError("Couldn't reach the server.", "network");
  }
  if (!res.ok) throw new ApiError(`The server answered ${res.status}.`, "server");
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("The server's reply wasn't JSON.", "shape");
  }
  return normalizeRun(json);
}
