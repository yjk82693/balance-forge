import type { LiveState } from "./useRunner";

/**
 * The phase to show. Hero Cards probes every card lever after the baseline and says nothing while it does, so a
 * finished baseline with no later phase is the probe. (A server that streams probe progress sets the phase itself.)
 */
export function shownPhase(live: LiveState, cards = false): LiveState["phase"] {
  if (!cards) return live.phase;
  if (live.phase === "diagnose") return "probe";
  const baselineDone = live.total > 0 && live.done >= live.total;
  return (live.phase === undefined || live.phase === "baseline") && baselineDone ? "probe" : live.phase;
}

/** True while the phase has no counter of its own to show: a bar that only shimmers, and the elapsed time. */
export function isIndeterminate(live: LiveState, cards = false): boolean {
  return shownPhase(live, cards) === "probe" && !(live.diagnose && live.diagnose.total > 0);
}
