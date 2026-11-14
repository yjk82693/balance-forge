import type { PlaytestRun } from "./api";
import { runFromFull } from "./fullRun";
import { EVEN_INTENT, STRENGTHS, pairKey, type Intent, type MatchupIntent } from "./intent";

export type ReanalyzeResult =
  | { kind: "ok"; run: PlaytestRun }
  /** the server has no reanalyze yet: the intent is saved, the numbers need a new run to follow it */
  | { kind: "absent" }
  | { kind: "failed"; message: string };

/**
 * POST /v1/playtest/reanalyze {runId}: the same games judged again against the intent now saved, with no new bot run.
 * A missing endpoint (404/405/501) is an answer, not an error: the caller says "re-run to apply".
 */
export async function reanalyze(runId: string, signal?: AbortSignal): Promise<ReanalyzeResult> {
  try {
    const res = await fetch("/v1/playtest/reanalyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
      signal,
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) return { kind: "absent" };
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { kind: "failed", message: body?.message ?? `The server answered ${res.status}.` };
    }
    const run = runFromFull(await res.json().catch(() => null));
    return run ? { kind: "ok", run } : { kind: "failed", message: "The server's answer had no report." };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { kind: "failed", message: "Could not reach the server." };
  }
}

/** The seven answers to "intended?" for a pair, A being the first hero: even, then A and B each slight/clear/strong. */
export interface Choice {
  id: string;
  label: string;
  value: MatchupIntent;
}

export function choicesFor(a: string, b: string): Choice[] {
  const side = (hero: string, name: string): Choice[] =>
    STRENGTHS.slice(1).map((strength) => ({
      id: `${name}-${strength}`,
      label: `${name} ${strength}`,
      value: { favored: hero, strength },
    }));
  return [{ id: "even", label: "Even", value: { strength: "even" } }, ...side(a, "A"), ...side(b, "B")];
}

/** The intent with the pair (a, b) set to `value`; even removes the entry. */
export function withChoice(intent: Intent = EVEN_INTENT, a: string, b: string, value: MatchupIntent): Intent {
  const matchups = { ...intent.matchups };
  if (value.strength === "even") delete matchups[pairKey(a, b)];
  else matchups[pairKey(a, b)] = value;
  return { ...intent, matchups };
}
