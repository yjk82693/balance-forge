// Runner Versus: two players, each runs the same course on their own phone. Pure helpers, no React.
// The server sends each seat its own state.view; its payload may carry `versus: { you, opponent: { x, state, alive } }`.

export type VersusSide = "solo" | "versus";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

export interface VersusRunner {
  id: string;
  x: number;
  state: string;
  alive: boolean;
  section: number;
  /** the pose, when the engine sends it: height above the ground, body height, and the wire when swinging */
  y?: number;
  height?: number;
  wire?: { anchorId: string; anchorX: number; anchorY: number; length: number } | null;
}

/** `you` is "p1"/"p2" on a phone and null on the big screen (which then sees the leader's run). */
export interface VersusInfo {
  you: string | null;
  runners: VersusRunner[];
  leader: string;
}

function wireOf(w: unknown): VersusRunner["wire"] {
  if (!isObject(w) || typeof w.anchorX !== "number" || typeof w.anchorY !== "number") return undefined;
  return {
    anchorId: typeof w.anchorId === "string" ? w.anchorId : "",
    anchorX: w.anchorX,
    anchorY: w.anchorY,
    length: typeof w.length === "number" ? w.length : 0,
  };
}

/** The `versus` block of a runner payload, if it is there and well formed; anything else is a solo run. */
export function versusOf(payload: unknown): VersusInfo | null {
  if (!isObject(payload) || !isObject(payload.versus)) return null;
  const v = payload.versus;
  if (!Array.isArray(v.runners)) return null;
  const runners: VersusRunner[] = [];
  for (const r of v.runners) {
    if (!isObject(r) || typeof r.id !== "string" || typeof r.x !== "number" || !Number.isFinite(r.x)) return null;
    runners.push({
      id: r.id,
      x: r.x,
      state: typeof r.state === "string" ? r.state : "running",
      alive: r.alive !== false,
      section: typeof r.section === "number" ? r.section : 1,
      ...(typeof r.y === "number" ? { y: r.y } : {}),
      ...(typeof r.height === "number" ? { height: r.height } : {}),
      ...(wireOf(r.wire) ? { wire: wireOf(r.wire) } : {}),
    });
  }
  return {
    you: typeof v.you === "string" ? v.you : null,
    runners,
    leader: typeof v.leader === "string" ? v.leader : (runners[0]?.id ?? ""),
  };
}

export type VersusEnd = "win" | "lose" | "draw";

/** What the end of the match means for the seat: win if it is among the winners, a draw if nobody won. */
export function versusEnd(winners: readonly string[], seat: string | undefined): VersusEnd {
  if (winners.length === 0) return "draw";
  return seat !== undefined && winners.includes(seat) ? "win" : "lose";
}

export const versusEndWords = (e: VersusEnd): string => (e === "win" ? "YOU WIN" : e === "lose" ? "YOU LOSE" : "DRAW");

/** What a runner is called on the big screen: the name typed on the phone, else "P1", "P2" (the seat id). */
export function laneLabel(id: string, names?: Readonly<Record<string, string>>): string {
  return names?.[id]?.trim() || id.toUpperCase();
}

/** The big screen's headline: "<name> WINS", or "DRAW" when nobody won (or both did). */
export function versusHeadline(winners: readonly string[], names?: Readonly<Record<string, string>>): string {
  if (winners.length !== 1) return "DRAW";
  return `${laneLabel(winners[0], names).toUpperCase()} WINS`;
}

/** A progress bar fill (0..1) from an x on a course that ends at finishX. */
export const barFill = (x: number, finishX: number): number =>
  finishX > 0 ? Math.max(0, Math.min(1, x / finishX)) : 0;

/** A match is versus when two seats played it. */
export const isVersusMatch = (players: readonly string[]): boolean => players.length === 2;

/** The runners of a versus match that no seat of the room belongs to are the bot: they are named "Bot". */
export function withBotNames(
  names: Readonly<Record<string, string>>,
  runners: readonly { id: string }[],
  seatIds: readonly string[],
): Record<string, string> {
  const out = { ...names };
  for (const r of runners) if (!seatIds.includes(r.id)) out[r.id] = "Bot";
  return out;
}

/** How long the last frame stays before the end card: long enough to see the fall. */
export const END_HOLD_MS = 1000;

/**
 * One small line saying why the match ended. `viewer` is the seat of a phone ("you"), null for the big screen.
 * The engine's reason says finish, opponent_down (the other runner fell), max_ticks or draw; it does not say whether
 * a pit or a wall did it, so the line says "fell".
 */
export function versusCause(
  end: { reason: string; winners: readonly string[] },
  runnerIds: readonly string[],
  viewer: string | null,
  names?: Readonly<Record<string, string>>,
): string {
  const winner = end.winners[0];
  if (winner === undefined) return end.reason === "draw" ? "Both fell together" : "No one got ahead";
  const who = (id: string, you: string, other: string) => (id === viewer ? you : `${laneLabel(id, names)} ${other}`);
  if (end.reason === "finish") return who(winner, "You crossed the finish first", "crossed the finish first");
  if (end.reason === "max_ticks") return who(winner, "Time ran out. You got further", "got further when time ran out");
  const loser = runnerIds.find((id) => id !== winner) ?? "";
  return loser ? who(loser, "You fell", "fell") : "A runner fell";
}

/** Team colours: P1 red, P2 blue (anything else, the bot, is blue). The tint is the light version for the sprite. */
const COLORS: Record<string, number> = { p1: 0xff5c5c, p2: 0x5ca8ff };
const TINTS: Record<string, number> = { p1: 0xffd6d6, p2: 0xd6e8ff };
export const laneColor = (id: string): number => COLORS[id] ?? COLORS.p2;
export const laneTint = (id: string): number => TINTS[id] ?? TINTS.p2;
export const laneColorName = (id: string): "RED" | "BLUE" => (id === "p1" ? "RED" : "BLUE");
export const cssColor = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

/**
 * Where the camera's left edge is, in world units, in a versus match. Both runners stay in view (centred between them)
 * while the gap fits in 80% of the view; a wider gap follows the leader, who then keeps `lead` of the view behind them.
 * `span` is the world width shown.
 */
export function versusCameraLeft(xs: readonly number[], span: number, lead: number): number {
  const hi = Math.max(...xs);
  const lo = Math.min(...xs);
  return hi - lo <= span * 0.8 ? (hi + lo) / 2 - span / 2 : hi - lead * span;
}
