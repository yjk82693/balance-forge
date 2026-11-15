// Sepia Tentacle Run (gameId tentacle_run). The state.view reading is in lib/runner.ts; this file keeps the id and the
// one helper the tentacle line uses.

export const TENTACLE_GAME_ID = "tentacle_run";

/** How many body segments to draw between Sepia and the anchor, capped. */
export function segmentCount(distance: number, segment: number): number {
  return Math.max(1, Math.min(24, Math.round(distance / Math.max(1, segment))));
}
