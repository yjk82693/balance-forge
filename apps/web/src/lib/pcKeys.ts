// Hero Arena from a keyboard (PC mode): arrows or WASD move, Space or J attacks (melee), Z or K uses the skill
// (projectile), X or L guards. Aim is the last move direction, as with the phone stick.

export type ArenaAction = "melee" | "projectile" | "guard";
export const ARENA_KEY_HINT = "Keyboard: arrows or WASD move · Space attack · Z skill · X guard";

export function actionKey(key: string): ArenaAction | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === " " || k === "Spacebar" || k === "j") return "melee";
  if (k === "z" || k === "k") return "projectile";
  if (k === "x" || k === "l") return "guard";
  return null;
}

type Dir = "up" | "down" | "left" | "right";
export function moveKey(key: string): Dir | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === "ArrowUp" || k === "w") return "up";
  if (k === "ArrowDown" || k === "s") return "down";
  if (k === "ArrowLeft" || k === "a") return "left";
  if (k === "ArrowRight" || k === "d") return "right";
  return null;
}

/** Held movement keys as a stick vector (-1..1 like the phone stick, y grows down); diagonals are normalised. */
export class MoveKeys {
  private held = new Map<string, Dir>();

  /** The new vector after a key change, or null when nothing changed (repeat, a key that is not a move key). */
  change(key: string, down: boolean): [number, number] | null {
    const dir = moveKey(key);
    if (!dir) return null;
    const before = this.vector();
    if (down) this.held.set(key, dir);
    else this.held.delete(key);
    const after = this.vector();
    return before[0] === after[0] && before[1] === after[1] ? null : after;
  }

  vector(): [number, number] {
    const has = (d: Dir) => [...this.held.values()].includes(d);
    const x = (has("right") ? 1 : 0) - (has("left") ? 1 : 0);
    const y = (has("down") ? 1 : 0) - (has("up") ? 1 : 0);
    if (x !== 0 && y !== 0) return [x * 0.7071, y * 0.7071];
    return [x, y];
  }

  /** Every key released (the window lost focus). */
  clear() {
    this.held.clear();
  }
}
