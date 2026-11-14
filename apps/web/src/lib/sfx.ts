import { useSyncExternalStore } from "react";

/**
 * Tiny WebAudio blips: no audio files. Starts after the first user gesture (browser rule);
 * respects the mute toggle.
 */
export type Blip = "hit" | "ko" | "shoot" | "guard" | "turn" | "play";

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem("bf-muted") === "1";
  } catch {
    return false;
  }
})();
const subs = new Set<() => void>();

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  return ctx;
}

// Unlock on the first gesture; before that, blips are silently skipped.
if (typeof window !== "undefined") {
  const unlock = () => {
    const a = audio();
    if (a && a.state === "suspended") void a.resume();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { passive: true });
}

const SPEC: Record<Blip, { type: OscillatorType; from: number; to: number; ms: number; gain: number }> = {
  hit: { type: "square", from: 260, to: 90, ms: 90, gain: 0.05 },
  ko: { type: "sawtooth", from: 320, to: 40, ms: 520, gain: 0.06 },
  shoot: { type: "triangle", from: 520, to: 880, ms: 70, gain: 0.04 },
  guard: { type: "sine", from: 300, to: 220, ms: 80, gain: 0.05 },
  turn: { type: "sine", from: 440, to: 660, ms: 110, gain: 0.04 },
  play: { type: "triangle", from: 360, to: 520, ms: 70, gain: 0.04 },
};

export function blip(kind: Blip) {
  if (muted) return;
  const a = audio();
  if (!a || a.state !== "running") return;
  const s = SPEC[kind];
  const t = a.currentTime;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = s.type;
  osc.frequency.setValueAtTime(s.from, t);
  osc.frequency.exponentialRampToValueAtTime(s.to, t + s.ms / 1000);
  g.gain.setValueAtTime(s.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + s.ms / 1000);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + s.ms / 1000 + 0.02);
}

export const isMuted = () => muted;
export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem("bf-muted", v ? "1" : "0");
  } catch {
    /* storage blocked: mute lasts for this page only */
  }
  subs.forEach((f) => f());
}
export function useMuted(): boolean {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => muted,
  );
}

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Haptic pulse where supported. */
export const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
};
