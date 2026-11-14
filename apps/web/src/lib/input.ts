import type { ActionInput } from "./contract";

export type ButtonAction = "melee" | "projectile" | "guard";
export type InputSource = "touch" | "gamepad" | "keyboard";

const MOVE_INTERVAL_MS = 33; // ~30 sends/s for small changes, well under the 120/s/seat cap in the contract
/** A change in the move vector (of 1000) this large, a stop, or a start is sent at once; smaller ones wait for the cap. */
const BIG_CHANGE = 150;
const clampInt = (v: number) => Math.max(-1000, Math.min(1000, Math.round(v * 1000)));

/**
 * Turns raw input (touch stick, gamepad stick, buttons) into ActionInput messages.
 * Every source goes through here, so a phone and a gamepad produce identical messages:
 *   move:       { actionId: "move", params: { moveX, moveY } }          (-1000..1000)
 *   buttons:    { actionId: "melee" | "projectile" | "guard", params: { aimX, aimY } }
 *               (aim = last non-zero stick direction)
 * The server decides legality; nothing here advances game state.
 */
export class InputPipeline {
  private seq = 0;
  private moves = new Map<InputSource, [number, number]>();
  private lastSent: [number, number] = [0, 0];
  private lastSentAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private aim: [number, number] = [1000, 0];

  constructor(
    private readonly playerId: string,
    private readonly getTick: () => number,
    private readonly send: (input: ActionInput) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  setMove(source: InputSource, x: number, y: number) {
    this.moves.set(source, [x, y]);
    this.scheduleMove();
  }

  press(action: ButtonAction) {
    this.emit(action, { aimX: this.aim[0], aimY: this.aim[1] });
  }

  dispose() {
    clearTimeout(this.timer);
    this.moves.clear();
  }

  private effective(): [number, number] {
    let best: [number, number] = [0, 0];
    let mag = 0;
    for (const [x, y] of this.moves.values()) {
      const m = x * x + y * y;
      if (m > mag) {
        mag = m;
        best = [x, y];
      }
    }
    return [clampInt(best[0]), clampInt(best[1])];
  }

  /** Release, a start from standstill or a change in direction or strength: worth sending without waiting. */
  private isBigChange(x: number, y: number): boolean {
    const [lx, ly] = this.lastSent;
    if (x === 0 && y === 0) return lx !== 0 || ly !== 0;
    if (lx === 0 && ly === 0) return true;
    return Math.hypot(x - lx, y - ly) >= BIG_CHANGE;
  }

  private scheduleMove() {
    const [x, y] = this.effective();
    if (this.isBigChange(x, y)) {
      clearTimeout(this.timer);
      this.timer = undefined;
      return this.flushMove();
    }
    const wait = this.lastSentAt + MOVE_INTERVAL_MS - this.now();
    if (wait <= 0) return this.flushMove();
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flushMove();
    }, wait);
  }

  private flushMove() {
    const [x, y] = this.effective();
    if (x === this.lastSent[0] && y === this.lastSent[1]) return;
    this.lastSent = [x, y];
    this.lastSentAt = this.now();
    if (x !== 0 || y !== 0) this.aim = [x, y];
    this.emit("move", { moveX: x, moveY: y });
  }

  private emit(actionId: string, params: Record<string, number>) {
    this.send({ playerId: this.playerId, seq: ++this.seq, tick: this.getTick(), turnId: 0, actionId, params });
  }
}
