// Keyboard controls of the Sepia Tentacle Run phone page on a PC: the same two buttons as the touch pad.
//   Space or ArrowUp = JUMP, ArrowDown or Shift = SLIDE; press on keydown, release on keyup, key repeat ignored.

import type { RunnerControl } from "./runnerInput.ts";

export const KEYBOARD_HINT = "Keyboard: Space jump · ↓ slide";

/** Which button a key drives; null for any other key. */
export function keyButton(key: string): keyof RunnerControl | null {
  if (key === " " || key === "Spacebar" || key === "ArrowUp") return "jump";
  if (key === "ArrowDown" || key === "Shift") return "slide";
  return null;
}

/**
 * Tracks the held keys of each button. A button is down while any of its keys is; `change` says what to send (a new
 * state of one button) or null when nothing changed (key repeat, a second key of a button that is already down).
 */
export class HeldKeys {
  private held = new Map<string, keyof RunnerControl>();

  change(key: string, down: boolean, repeat = false): { button: keyof RunnerControl; down: boolean } | null {
    const button = keyButton(key);
    if (!button || repeat) return null;
    const before = this.isDown(button);
    if (down) this.held.set(key, button);
    else this.held.delete(key);
    const after = this.isDown(button);
    return before === after ? null : { button, down: after };
  }

  private isDown(button: keyof RunnerControl): boolean {
    for (const b of this.held.values()) if (b === button) return true;
    return false;
  }

  /** Every key released (the window lost focus): the buttons that were down. */
  releaseAll(): (keyof RunnerControl)[] {
    const down = [...new Set(this.held.values())];
    this.held.clear();
    return down;
  }
}

/** True on a touch-first device (a phone or tablet), where the keyboard hint is not shown. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
}
