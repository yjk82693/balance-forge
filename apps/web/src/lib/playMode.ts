import { useSyncExternalStore } from "react";

/** How a lobby player joins: Mobile = the phone over the QR code; PC = this browser tab plays with the keyboard. */
export type PlayMode = "mobile" | "pc";

/** The games that can be played from a keyboard in this tab (Hero Cards: the highlight moves, Enter plays). */
export const PC_GAMES = ["hero_arena", "hero_cards", "tentacle_run"];
export const hasPcMode = (gameId: string): boolean => PC_GAMES.includes(gameId);

const KEY = "bf-play-mode";
const listeners = new Set<() => void>();

function read(): PlayMode {
  try {
    return localStorage.getItem(KEY) === "pc" ? "pc" : "mobile";
  } catch {
    return "mobile"; // storage blocked: today's flow
  }
}
let current: PlayMode = read();

/** The remembered choice of this browser. */
export const getPlayMode = (): PlayMode => current;

export function setPlayMode(mode: PlayMode) {
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* the choice lasts until the page is left */
  }
  listeners.forEach((l) => l());
}

export function usePlayMode(): PlayMode {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => "mobile" as PlayMode,
  );
}
