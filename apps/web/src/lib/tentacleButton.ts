// The one tentacle button of the Sepia Tentacle Run phone: a tap whips, a hold of LONG_PRESS_MS or more throws the rope
// (latch) toward the stick direction (the pipeline aims at the last stick direction: the facing when the stick is
// idle). Both send the existing `whip` and `latch` actions; nothing else changes.

export const LONG_PRESS_MS = 250;

export type TentacleAction = "whip" | "latch";

/** What a press that lasted `heldMs` does when it is let go. */
export const pressKind = (heldMs: number): TentacleAction => (heldMs >= LONG_PRESS_MS ? "latch" : "whip");

/** How full the rope-charge ring is after `heldMs` (0..1). */
export const chargeFraction = (heldMs: number): number => Math.max(0, Math.min(1, heldMs / LONG_PRESS_MS));
