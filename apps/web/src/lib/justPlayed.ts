import type { MatchResult } from "./contract";

export interface JustPlayed {
  result: MatchResult;
  names: Record<string, string>;
  heroes: Record<string, string>;
}

const KEY = "bf-just-played";

export function saveJustPlayed(v: JustPlayed) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the highlight just won't survive a route change */
  }
}

export function loadJustPlayed(): JustPlayed | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as JustPlayed) : null;
  } catch {
    return null;
  }
}
