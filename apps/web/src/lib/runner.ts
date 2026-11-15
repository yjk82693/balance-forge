// Sepia Tentacle Run, a 2D side-scrolling wire runner (gameId tentacle_run): the web's reading of the state.view
// payload, mirroring TentacleObservationPayload in packages/contracts/types.ts and packages/games/tentacle/SPEC.md.
// Side view: x grows to the right, y grows UP with the ground at y = 0.
// The camera shows [cameraX, cameraX + viewWidth].

export const TENTACLE_VIEW_WIDTH = 16000;

export type RunnerPlayerState = "running" | "jumping" | "sliding" | "swinging";

export interface RunnerObstacle {
  id: string;
  kind: "pit" | "lowBar" | "wall";
  /** left edge and width; a pit has y = 0, h = 0 (a gap in the ground); a lowBar spans y..y+h in the air */
  x: number;
  w: number;
  y: number;
  h: number;
  section: number;
}

export interface RunnerAnchor {
  id: string;
  x: number;
  y: number;
  section: number;
}

export interface RunnerPayload {
  /** 1..sectionCount; the last is the Man-Shark chase */
  section: number;
  sectionCount: number;
  sectionStartX: number;
  sectionEndX: number;
  cameraX: number;
  viewWidth: number;
  finishX: number;
  player: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    state: RunnerPlayerState;
    /** 1200 standing, jumping or swinging; 500 sliding */
    height: number;
    jumpHeldTicks: number;
    wire: null | { anchorId: string; anchorX: number; anchorY: number; length: number };
  };
  obstacles: RunnerObstacle[];
  anchors: RunnerAnchor[];
  /** the Man-Shark chasing in the last section, drawn behind Sepia */
  shark: null | { x: number };
  outcome?: { status: "running" | "win" | "draw"; winners: string[]; reason: string };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const isRunnerPayload = (p: unknown): p is RunnerPayload =>
  isObject(p) &&
  isObject(p.player) &&
  isNum(p.player.x) &&
  isNum(p.player.y) &&
  isNum(p.cameraX) &&
  isNum(p.viewWidth) &&
  isNum(p.finishX) &&
  isNum(p.section) &&
  Array.isArray(p.obstacles) &&
  Array.isArray(p.anchors);

/** The section label ("Section 3 of 6"); the last one is the Man-Shark chase. */
export function sectionLabel(p: Pick<RunnerPayload, "section" | "sectionCount">): string {
  if (p.section >= p.sectionCount) return "Man-Shark chase";
  return `Section ${Math.max(1, p.section)} of ${p.sectionCount}`;
}

/** Screen x of a world x for a camera at `cameraX` showing `viewWidth` units across `screenW` pixels. */
export const toScreenX = (worldX: number, cameraX: number, viewWidth: number, screenW: number): number =>
  ((worldX - cameraX) / viewWidth) * screenW;

/** The ground segments that remain between the pits of a stretch [from, to] of the course (left to right). */
export function groundSegments(pits: { x: number; w: number }[], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let at = from;
  for (const p of [...pits].sort((a, b) => a.x - b.x)) {
    if (p.x + p.w <= from || p.x >= to) continue;
    if (p.x > at) out.push([at, Math.min(p.x, to)]);
    at = Math.max(at, p.x + p.w);
  }
  if (at < to) out.push([at, to]);
  return out;
}

/** How far along the course the player is (0..1). */
export const progress = (p: Pick<RunnerPayload, "finishX" | "player">): number =>
  p.finishX > 0 ? Math.max(0, Math.min(1, p.player.x / p.finishX)) : 0;
