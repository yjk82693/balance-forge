import { useSyncExternalStore } from "react";
import type { RunGame } from "./api";
import { TENTACLE_RUN_ENABLED } from "./featureFlags";

export type DashGame = RunGame;

export const GAME_LABEL: Record<DashGame, string> = {
  hero_arena: "Hero Arena",
  hero_cards: "Hero Cards",
  tentacle_run: "Tentacle Run",
};

/** The decks of Hero Cards: the matchup a cards run measures is two of these. */
export const DECKS = ["nightcrow", "standard"] as const;
export type DeckPair = [string, string];
/** What the engine plays when no pair is given. */
export const DEFAULT_DECKS: DeckPair = ["nightcrow", "standard"];

const KEY = "bf-game";
const DECK_KEY = "bf-decks";
const listeners = new Set<() => void>();

const isGame = (v: unknown): v is DashGame =>
  v === "hero_arena" || v === "hero_cards" || (v === "tentacle_run" && TENTACLE_RUN_ENABLED);

/** `#/dashboard?game=cards` (or `=hero_cards`) opens the cards dashboard directly. */
function fromUrl(): DashGame | null {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "").get("game");
  if ((q === "tentacle" || q === "tentacle_run") && TENTACLE_RUN_ENABLED) return "tentacle_run";
  return q === "cards" || q === "hero_cards" ? "hero_cards" : q === "arena" || q === "hero_arena" ? "hero_arena" : null;
}

export function loadGame(): DashGame {
  const asked = fromUrl();
  if (asked) return asked;
  try {
    const raw = sessionStorage.getItem(KEY);
    return isGame(raw) ? raw : "hero_arena";
  } catch {
    return "hero_arena";
  }
}

let current: DashGame | null = null;

export function setGame(game: DashGame) {
  current = game;
  try {
    sessionStorage.setItem(KEY, game);
  } catch {
    /* storage blocked: the choice lasts until the page is left */
  }
  listeners.forEach((l) => l());
}

const snapshot = (): DashGame => (current ??= loadGame());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The game the dashboard is showing; the switch in its top bar changes it. */
export function useDashGame(): DashGame {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const validDecks = (m: unknown): m is DeckPair =>
  Array.isArray(m) &&
  m.length === 2 &&
  m[0] !== m[1] &&
  m.every((d) => (DECKS as readonly string[]).includes(d as string));

export function loadDecks(): DeckPair {
  try {
    const raw = JSON.parse(sessionStorage.getItem(DECK_KEY) ?? "null");
    return validDecks(raw) ? raw : DEFAULT_DECKS;
  } catch {
    return DEFAULT_DECKS;
  }
}

export function saveDecks(m: DeckPair) {
  try {
    sessionStorage.setItem(DECK_KEY, JSON.stringify(m));
  } catch {
    /* storage blocked */
  }
}
