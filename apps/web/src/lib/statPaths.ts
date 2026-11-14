import { HEROES, heroName } from "./heroes";

/**
 * Health and speed are hero-only patch levers (contract v0.1.2): `/characters/N/health` and `/characters/N/speed`,
 * within ±40% of the root data and inside an absolute range. N is the hero's place in the data (the order of HEROES).
 * The base values are a copy of the shipped data, used only to say what range a change may take.
 */
const BASE: Record<string, { health: number; speed: number }> = {
  bari: { health: 540, speed: 120 },
  real_armor: { health: 700, speed: 85 },
  daewi: { health: 580, speed: 110 },
  sepia: { health: 480, speed: 150 },
  nightcrow: { health: 480, speed: 150 },
};
const ABSOLUTE = { health: [100, 3000], speed: [30, 400] } as const;
const SHARE = 0.4;

export type Stat = "health" | "speed";

/** The hero and stat a `/characters/N/<stat>` path names; null for any other path. */
export function characterPath(path: string): { hero: string; stat: Stat } | null {
  const m = path.match(/^\/characters\/(\d+)\/(health|speed)$/);
  const hero = m ? HEROES[Number(m[1])]?.id : undefined;
  return m && hero ? { hero, stat: m[2] as Stat } : null;
}

/** "Daewi · Speed" for `/characters/2/speed`, or undefined for a path that is not a hero stat. */
export function statLabel(path: string): string | undefined {
  const c = characterPath(path);
  return c ? `${heroName(c.hero)} · ${c.stat === "health" ? "Health" : "Speed"}` : undefined;
}

/** What value a change to this path may take: 60%..140% of the shipped value, inside the absolute limits. */
export function allowedRange(path: string): [number, number] | null {
  const c = characterPath(path);
  const base = c && BASE[c.hero]?.[c.stat];
  if (!c || !base) return null;
  const [min, max] = ABSOLUTE[c.stat];
  return [Math.max(min, Math.round(base * (1 - SHARE))), Math.min(max, Math.round(base * (1 + SHARE)))];
}

/** "allowed 66–154" for a hero stat path, else null (move and tuning paths show no range). */
export function rangeNote(path: string): string | null {
  const r = allowedRange(path);
  return r ? `allowed ${r[0]}–${r[1]} (±40% of the original)` : null;
}
