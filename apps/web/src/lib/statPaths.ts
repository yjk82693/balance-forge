import { heroName } from "./heroes";
import { getHeroStats } from "./heroStats";

/**
 * Health and speed are hero-only patch levers (contract v0.1.2): `/characters/N/health` and `/characters/N/speed`,
 * within ±40% of the root data and inside an absolute range. The hero at position N and the base values come from the
 * server (lib/heroStats.ts); until they are read, a path is labelled by its position and shows no range.
 */
const ABSOLUTE = { health: [100, 3000], speed: [30, 400] } as const;
const SHARE = 0.4;

export type Stat = "health" | "speed";

/** The position and stat a `/characters/N/<stat>` path names; null for any other path. */
export function characterPath(path: string): { index: number; stat: Stat } | null {
  const m = path.match(/^\/characters\/(\d+)\/(health|speed)$/);
  return m ? { index: Number(m[1]), stat: m[2] as Stat } : null;
}

/** "Daewi · Speed" for `/characters/2/speed` ("Hero 2 · Speed" before the data is read); undefined for other paths. */
export function statLabel(path: string): string | undefined {
  const c = characterPath(path);
  if (!c) return undefined;
  const id = getHeroStats()?.heroes[c.index];
  return `${id ? heroName(id) : `Hero ${c.index}`} · ${c.stat === "health" ? "Health" : "Speed"}`;
}

/** What value a change may take: 60%..140% of the root value, inside the absolute limits; null if unknown. */
export function allowedRange(path: string): [number, number] | null {
  const c = characterPath(path);
  const base = c && getHeroStats()?.base[c.index]?.[c.stat];
  if (!c || !base) return null;
  const [min, max] = ABSOLUTE[c.stat];
  return [Math.max(min, Math.round(base * (1 - SHARE))), Math.min(max, Math.round(base * (1 + SHARE)))];
}

/** "allowed 66–154 (±40% of the original)" for a hero stat path whose base is known, else null. */
export function rangeNote(path: string): string | null {
  const r = allowedRange(path);
  return r ? `allowed ${r[0]}–${r[1]} (±40% of the original)` : null;
}
