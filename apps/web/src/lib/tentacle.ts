// Sepia Tentacle Run (gameId tentacle_run): the web's reading of the state.view payload, mirroring
// TentacleObservationPayload in packages/contracts/types.ts and packages/games/tentacle/SPEC.md.
// Arena: integers in 16000 x 9000, origin top-left, y grows downwards. One tick = 1/60 s. The seat is "p1".

export const ARENA = { w: 16000, h: 9000 } as const;
export const TENTACLE_GAME_ID = "tentacle_run";

export type TentacleKind = "player" | "walker" | "drone" | "sentry" | "boss";

export interface TentacleEntity {
  id: string;
  kind: TentacleKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facingX?: number;
  facingY?: number;
  /** player only: while latched, the tentacle goes from the player to posts[post] */
  latch?: { post: number; untilTick: number } | null;
  latchReadyTick?: number;
  whipReadyTick?: number;
  invulnerableUntilTick?: number;
  whipUntilTick?: number;
}

export interface TentaclePost {
  id: number;
  x: number;
  y: number;
}

export interface TentacleShot {
  id: string;
  x: number;
  y: number;
  from: "drone" | "sentry" | "boss";
}

export interface TentaclePayload {
  /** 0 = the break before wave 1, 1..waveCount = the waves, waveCount + 1 = the Man-Shark */
  wave: number;
  waveCount: number;
  waveTick?: number;
  /** the player first, then the enemies in spawn order */
  entities: TentacleEntity[];
  posts: TentaclePost[];
  projectiles: TentacleShot[];
  boss: null | { hp: number; maxHp: number; phase: number; phases: number };
  outcome?: { status: "running" | "win" | "draw"; winners: string[]; reason: string };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const isTentaclePayload = (p: unknown): p is TentaclePayload =>
  isObject(p) &&
  isNum(p.wave) &&
  isNum(p.waveCount) &&
  Array.isArray(p.entities) &&
  Array.isArray(p.posts) &&
  Array.isArray(p.projectiles);

/** How many body segments to draw between Sepia and the post, capped. */
export function segmentCount(distance: number, segment: number): number {
  return Math.max(1, Math.min(24, Math.round(distance / Math.max(1, segment))));
}

/** Where on a canvas of w x h an arena point lands (the arena is stretched to fill it; both are 16:9). */
export function toCanvas(p: { x: number; y: number }, w: number, h: number) {
  return { x: (p.x / ARENA.w) * w, y: (p.y / ARENA.h) * h };
}

/** The label of the wave counter: "Get ready", "Wave 3 of 5" or the boss. */
export function waveLabel(p: Pick<TentaclePayload, "wave" | "waveCount">): string {
  if (p.wave <= 0) return "Get ready";
  if (p.wave > p.waveCount) return "Man-Shark";
  return `Wave ${p.wave} of ${p.waveCount}`;
}

/** Phase pips of the boss bar: one per third of its health still to go (phase 0 is the top third). */
export const activePips = (phase: number, phases: number): number => Math.max(0, Math.min(phases, phases - phase));
