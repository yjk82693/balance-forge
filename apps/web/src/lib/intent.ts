import { useEffect, useState } from "react";
import { intentBody } from "./intentBody";
import { IS_STATIC } from "./staticMode";
import { HEROES, heroName } from "./heroes";
import { isMockMode } from "../mock/types";

/**
 * The designer's intent for every matchup (`/v1/design/hero_arena/intent`): which hero should be favored and by how
 * much. The target win rate of the favored side is 50 / 55 / 60 / 65%, and the fair band is the target ±5 points.
 * Without an intent every matchup is intended to be even (45–55%).
 */
export type Strength = "even" | "slight" | "clear" | "strong";
export const STRENGTHS: Strength[] = ["even", "slight", "clear", "strong"];
const TARGET_RATE: Record<Strength, number> = { even: 0.5, slight: 0.55, clear: 0.6, strong: 0.65 };
export const BAND_HALF = 0.05;

export interface MatchupIntent {
  favored?: string;
  strength: Strength;
}
export interface Intent {
  /** the server wants a short string (it names the intent a result was judged against) */
  version: string;
  /** keyed "a vs b", the hero ids in alphabetical order, like the report's dimensions */
  matchups: Record<string, MatchupIntent>;
}

export const EVEN_INTENT: Intent = { version: "", matchups: {} };

/** The key a pair is stored under: hero ids sorted, as the report names its rows. */
export const pairKey = (a: string, b: string) => [a, b].sort().join(" vs ");

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** An intent from the wire; unusable entries are dropped, anything unusable altogether gives all even. */
export function parseIntent(raw: unknown): Intent {
  if (!isObject(raw) || !isObject(raw.matchups)) return EVEN_INTENT;
  const matchups: Record<string, MatchupIntent> = {};
  for (const [key, v] of Object.entries(raw.matchups)) {
    const [a, b] = key.split(" vs ");
    if (!isObject(v) || !a || !b || !HEROES.some((h) => h.id === a) || !HEROES.some((h) => h.id === b)) continue;
    const strength = STRENGTHS.includes(v.strength as Strength) ? (v.strength as Strength) : "even";
    const favored = v.favored === a || v.favored === b ? (v.favored as string) : undefined;
    if (strength !== "even" && favored) matchups[pairKey(a, b)] = { favored, strength };
  }
  const version = typeof raw.version === "string" || typeof raw.version === "number" ? String(raw.version) : "";
  return { version, matchups };
}

/** What a row `a vs b` should come to, for the hero named first (a). */
export interface Target {
  rate: number;
  band: [number, number];
  strength: Strength;
  favored?: string;
  /** "intended: Bari favored (60%)", or "intended: even (50%)" */
  label: string;
}

let current: Intent = EVEN_INTENT;
const listeners = new Set<() => void>();
export const getIntent = () => current;
export function setIntent(next: Intent) {
  current = next;
  listeners.forEach((fn) => fn());
}

/** The target for the hero named `a` in a matchup against `b`, from the intent in use. */
export function targetFor(a: string, b: string, intent: Intent = current): Target {
  const m = intent.matchups[pairKey(a, b)];
  const delta = m ? TARGET_RATE[m.strength] - 0.5 : 0;
  const rate = !m ? 0.5 : m.favored === a ? 0.5 + delta : 0.5 - delta;
  const label = m?.favored
    ? `intended: ${heroName(m.favored)} favored (${Math.round(TARGET_RATE[m.strength] * 100)}%)`
    : "intended: even (50%)";
  const band: [number, number] = [rate - BAND_HALF, rate + BAND_HALF];
  return { rate, band, strength: m?.strength ?? "even", favored: m?.favored, label };
}

/** The target of a row that carries its own (the analysis's number): whoever is above 50% is the favored one. */
export function targetFromRate(a: string, b: string, rate: number): Target {
  const favored = rate > 0.5 ? a : rate < 0.5 ? b : undefined;
  const top = Math.round(Math.max(rate, 1 - rate) * 100);
  const label = favored ? `intended: ${heroName(favored)} favored (${top}%)` : "intended: even (50%)";
  const band: [number, number] = [rate - BAND_HALF, rate + BAND_HALF];
  const strength = STRENGTHS.find((s) => Math.abs(TARGET_RATE[s] - Math.max(rate, 1 - rate)) < 0.0251) ?? "even";
  return { rate, band, strength, favored, label };
}

/** The states a cell cycles through for the pair (a, b): even, a slight/clear/strong, b slight/clear/strong. */
export function cycleStates(a: string, b: string): MatchupIntent[] {
  const side = (hero: string): MatchupIntent[] => STRENGTHS.slice(1).map((strength) => ({ favored: hero, strength }));
  return [{ strength: "even" }, ...side(a), ...side(b)];
}

/** The intent after one click on the cell (a, b): the next state in the cycle. */
export function cycle(intent: Intent, a: string, b: string): Intent {
  const states = cycleStates(a, b);
  const m = intent.matchups[pairKey(a, b)];
  const at = m ? states.findIndex((s) => s.favored === m.favored && s.strength === m.strength) : 0;
  const next = states[(at + 1) % states.length];
  const matchups = { ...intent.matchups };
  if (next.strength === "even") delete matchups[pairKey(a, b)];
  else matchups[pairKey(a, b)] = next;
  return { ...intent, matchups };
}

/** Is anything other than even intended? */
export const hasIntent = (intent: Intent = current) => Object.keys(intent.matchups).length > 0;

const PATH = "/v1/design/hero_arena/intent";

/** GET the saved intent; an absent endpoint or a failed read gives all even. */
const committed = import.meta.glob("../../../../services/room/design/hero_arena-intent.json", { import: "default" });

export async function loadIntent(signal?: AbortSignal): Promise<{ intent: Intent; found: boolean }> {
  if (IS_STATIC) {
    // The static build reads the approved chart that is committed with the repository, never the server.
    const load = Object.values(committed)[0];
    return load ? { intent: parseIntent(await load()), found: true } : { intent: EVEN_INTENT, found: false };
  }
  try {
    const res = await fetch(PATH, { signal });
    if (!res.ok) return { intent: EVEN_INTENT, found: false };
    return { intent: parseIntent(await res.json()), found: true };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { intent: EVEN_INTENT, found: false };
  }
}

/** PUT the intent (all ten pairs; even ones carry no favorite); returns what the server now holds. */
export async function saveIntent(intent: Intent): Promise<Intent> {
  const res = await fetch(PATH, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intentBody(intent)),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new Error(`${body?.code ? `${body.code}: ` : ""}${body?.message ?? `The server answered ${res.status}.`}`);
  }
  const saved = parseIntent(await res.json().catch(() => null));
  return saved === EVEN_INTENT && hasIntent(intent) ? intent : saved; // an empty reply: what we sent stands
}

/** Reads the intent once when a screen mounts (not in `?mock=1`) and re-renders when it arrives or changes. */
export function useIntent(): Intent {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    const controller = new AbortController();
    if (!isMockMode()) {
      loadIntent(controller.signal).then(({ intent }) => {
        if (!controller.signal.aborted) setIntent(intent);
      });
    }
    return () => {
      listeners.delete(bump);
      controller.abort();
    };
  }, []);
  return current;
}
