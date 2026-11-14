import { HEROES } from "./heroes.ts";

/** What PUT /v1/design/<game>/intent takes: a short string version and every pair of heroes (even ones carry none). */
export interface IntentBodyIn {
  matchups: Record<string, { favored?: string; strength: string }>;
}

const pairKey = (a: string, b: string) => [a, b].sort().join(" vs ");

/**
 * The request body for saving an intent. A saved change is a new version of the intent, so `version` is a fresh short
 * string (the engine rejects anything else, a number included).
 */
export function intentBody(intent: IntentBodyIn, now: number = Date.now()) {
  const matchups: Record<string, unknown> = {};
  for (let i = 0; i < HEROES.length; i++) {
    for (let j = i + 1; j < HEROES.length; j++) {
      const key = pairKey(HEROES[i].id, HEROES[j].id);
      matchups[key] = intent.matchups[key] ?? { strength: "even" };
    }
  }
  return { version: `ui-${now.toString(36)}`, matchups };
}
