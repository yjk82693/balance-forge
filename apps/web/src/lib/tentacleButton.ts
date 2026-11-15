// The JUMP button of the Sepia Tentacle Run phone. It only reports held / released (the control flags); the engine
// tells a tap (< tapTicks, a jump) from a hold in the air near an anchor (the wire). The ring fills while holding, over
// about the engine's tap length (12 ticks = 200 ms), so the player sees the press turn from a jump into the wire.

export const RING_MS = 200;

/** How full the ring is after `heldMs` (0..1). */
export const chargeFraction = (heldMs: number): number => Math.max(0, Math.min(1, heldMs / RING_MS));
