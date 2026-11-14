import type { PatchProposal, Report } from "./contract";
import { fixturePatch } from "./fixtures";
import { mockReport } from "./mockReport";
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

const isReport = (r: unknown): r is Report =>
  !!r && typeof r === "object" && Array.isArray((r as Report).rows) && typeof (r as Report).validMatches === "number";

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
          patch: p.patch as PatchProposal,
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
  return { baseline, patched: isReport(patched) ? patched : undefined, proposal, verdict };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runPlaytest(matches = 1000, signal?: AbortSignal): Promise<PlaytestRun> {
  if (isMockMode()) {
    await delay(1200);
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
