// The runner's phone input: the action "control" { jump: 0|1, slide: 0|1 } with HELD flags, sent whenever a button
// state changes (press or release); the game keeps the last control. A tap on jump is a jump, a hold in the air near an
// anchor is the wire, a release lets go (the engine decides; the phone only reports the buttons). See SPEC.md.

export interface RunnerControl {
  jump: 0 | 1;
  slide: 0 | 1;
}

export const NO_CONTROL: RunnerControl = { jump: 0, slide: 0 };

export const CONTROL_ACTION = "control";

/** The ActionInput params of a control state. */
export const controlParams = (c: RunnerControl): Record<string, number> => ({ jump: c.jump, slide: c.slide });

/** The next control after one button changes; null when nothing changed (nothing is sent). */
export function withButton(c: RunnerControl, button: keyof RunnerControl, down: boolean): RunnerControl | null {
  const value = down ? 1 : 0;
  return c[button] === value ? null : { ...c, [button]: value };
}
