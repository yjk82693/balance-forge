// The runner's art slots. Each file the artist delivers drops into public/assets/sepia_tentacle_run/runner/ under its
// slot name and is used when present; with no file the scene and buttons keep their code-drawn fallback. A slot is
// "present" when the image really loads (a server answering a missing path with its index page does not count).

export const RUNNER_ART_DIR = "assets/sepia_tentacle_run/runner";

const RUN_FRAMES = [1, 2, 3, 4, 5, 6].map((n) => `sepia_run_${n}`);
const BUILDINGS = [1, 2, 3].map((n) => `hook_building_${n}`);

export const RUNNER_SLOTS = [
  ...RUN_FRAMES,
  "sepia_jump_up",
  "sepia_jump_fall",
  "sepia_slide",
  "sepia_hook_throw",
  "sepia_swing",
  "sepia_down",
  ...BUILDINGS,
  "bg_far",
  "bg_mid",
  "bg_near",
  "ground_tile",
  "pit_edge",
  "low_bar",
  "wall",
  "btn_jump",
  "btn_jump_pressed",
  "btn_slide",
  "btn_slide_pressed",
] as const;

export type RunnerSlot = (typeof RUNNER_SLOTS)[number];

export const slotPath = (slot: string): string => `${RUNNER_ART_DIR}/${slot}.png`;

/** World units of running per frame of the run cycle: the legs follow the distance, so the speed always matches. */
export const RUN_STRIDE = 700;

/** Which run frame (0..5) to show at course position `x`. */
export const runFrameIndex = (x: number): number => (((Math.floor(x / RUN_STRIDE) % 6) + 6) % 6);

export interface SpriteState {
  state: "running" | "jumping" | "sliding" | "swinging";
  vy: number;
  x: number;
  /** a wire has been thrown but she is not swinging yet */
  hooking: boolean;
  /** the run is over because she fell or hit something */
  down: boolean;
}

/** The slot of Sepia's sprite for a state; the caller falls back to its drawn body when the slot has no file. */
export function sepiaSlot(s: SpriteState): string {
  if (s.down) return "sepia_down";
  if (s.state === "swinging") return "sepia_swing";
  if (s.state === "sliding") return "sepia_slide";
  if (s.state === "jumping") return s.hooking ? "sepia_hook_throw" : s.vy > 0 ? "sepia_jump_up" : "sepia_jump_fall";
  return RUN_FRAMES[runFrameIndex(s.x)];
}

/** Which hook building stands under an anchor (stable per anchor id). */
export function buildingSlot(anchorId: string): string {
  let h = 0;
  for (const c of anchorId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return BUILDINGS[h % BUILDINGS.length];
}

/**
 * How the sliced sheets are laid out (meta.json, written by scripts/slice_runner_art.py): a 512 cell, the feet baseline
 * 40 px above its bottom, the standing body this high, and the hook ring this far below the top of a 1024 hook cell.
 */
export interface RunnerMeta {
  canvas: number;
  feetY: number;
  bodyHeight: number;
  ringFromTop: number;
  /** each hook building: its size and where its ring centre is (slicer, measured), in its own pixels */
  hooks?: Record<string, { w: number; h: number; ringX: number; ringY: number }>;
  /** the size of each tile and button piece */
  tiles?: Record<string, { w: number; h: number }>;
}
export const DEFAULT_META: RunnerMeta = { canvas: 512, feetY: 472, bodyHeight: 400, ringFromTop: 80 };

/** Display size of a character cell so the standing body is `bodyPx` high on screen. */
export const spriteDisplay = (bodyPx: number, m: RunnerMeta = DEFAULT_META): number =>
  (bodyPx * m.canvas) / m.bodyHeight;

/** Where the feet are on a character cell, as a fraction of its height (the sprite's origin y). */
export const feetOrigin = (m: RunnerMeta = DEFAULT_META): number => m.feetY / m.canvas;

/**
 * A hook building is a 1024 cell standing on its bottom edge with the ring `ringFromTop` below its top: how big to
 * draw it so the ring sits at the anchor, when the ground is `groundToAnchor` pixels below the anchor.
 */
export function hookDisplay(groundToAnchor: number, m: RunnerMeta = DEFAULT_META): number {
  const frac = 1 - m.ringFromTop / 1024;
  return Math.max(40, groundToAnchor) / frac;
}

export interface HookPlacement {
  /** display size in pixels and the origin (0..1) that puts the ring centre on the anchor */
  width: number;
  height: number;
  originX: number;
  originY: number;
}

/**
 * Where a measured hook building goes: scaled so its base reaches the ground (`groundToAnchor` pixels below the anchor)
 * with the ring centre exactly on the anchor. Null when the slicer has not measured this building.
 */
export function hookPlacement(slot: string, groundToAnchor: number, m: RunnerMeta): HookPlacement | null {
  const h = m.hooks?.[slot];
  if (!h || h.h <= h.ringY) return null;
  const scale = Math.max(40, groundToAnchor) / (h.h - h.ringY);
  return { width: h.w * scale, height: h.h * scale, originX: h.ringX / h.w, originY: h.ringY / h.h };
}

const cache = new Map<string, Promise<string | null>>();

/** The URL of a slot when its file exists and decodes as an image, else null. Asked once per slot. */
export function probeSlot(slot: string, url: string): Promise<string | null> {
  const hit = cache.get(slot);
  if (hit) return hit;
  const p = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? url : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cache.set(slot, p);
  return p;
}
