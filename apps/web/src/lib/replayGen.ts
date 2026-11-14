import type { ArenaPayload, Observation } from "./contract";

/**
 * Deterministic visual replay for ?mock=1 and for the side-by-side compare view when the API sends no replay.
 * Integer math and a seeded xorshift32 only, so the same seed gives the same frames for both data versions;
 * only the damage numbers differ. It illustrates a match, it is never a result.
 */
export type Version = "broken" | "patched";

export const ROUND = 40; // frames per round: 20 for p1's shot, 20 for p2's
export const ROUNDS = 6;
export const HOLD = 20;
export const FRAME_MS = 100;
const MAX_HP = 100;

/** [damage p1 deals to p2 per hit, damage p2 deals to p1 per hit] */
const DAMAGE: Record<Version, [number, number]> = { broken: [26, 10], patched: [14, 12] };

const KINDS: Record<string, string> = {
  bari: "spirit_arrow",
  real_armor: "blaster_burst",
  daewi: "hypnosis_ripple",
  sepia: "tentacle_lash",
  nightcrow: "crow_dive",
};
export const projectileKind = (hero: string) => KINDS[hero] ?? "spirit_arrow";

function xorshift32(x: number): number {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** Same for both versions: the seed fixes positions, the version fixes damage. */
function jitter(seed: number, rounds: number): number[] {
  let s = seed >>> 0 || 1;
  return Array.from({ length: rounds }, () => {
    s = xorshift32(s);
    return (s % 1201) - 600;
  });
}

const tri = (f: number, period: number) => {
  const h = period / 2;
  const m = ((f % period) + period) % period;
  return m < h ? m : period - m; // 0..h
};

function koFrame(v: Version): number {
  const [a, b] = DAMAGE[v];
  let hp1 = MAX_HP;
  let hp2 = MAX_HP;
  for (let r = 0; r < ROUNDS; r++) {
    hp2 -= a;
    if (hp2 <= 0) return r * ROUND + 19;
    hp1 -= b;
    if (hp1 <= 0) return r * ROUND + 39;
  }
  return ROUNDS * ROUND - 1;
}

export const loopLength = (v: Version) => koFrame(v) + 1 + HOLD;

export function frameAt(frame: number, v: Version, seed: number, heroes: [string, string]): Observation<ArenaPayload> {
  const ko = koFrame(v);
  const f = frame % loopLength(v);
  const live = Math.min(f, ko);
  const [a, b] = DAMAGE[v];
  let hp1 = MAX_HP;
  let hp2 = MAX_HP;
  for (let r = 0; r <= Math.floor(live / ROUND); r++) {
    if (r * ROUND + 19 <= live) hp2 = Math.max(0, hp2 - a);
    if (hp2 > 0 && r * ROUND + 39 <= live) hp1 = Math.max(0, hp1 - b);
  }
  const J = jitter(seed, ROUNDS);
  const round = Math.min(ROUNDS - 1, Math.floor(live / ROUND));
  const x1 = 4200 + tri(f, 30) * 40;
  const x2 = 11800 - tri(f + 10, 36) * 30;
  const y1 = 4500 + J[round];
  const y2 = 4500 - J[round];
  const phase = live % ROUND;
  const projectiles: ArenaPayload["projectiles"] = [];
  if (f < ko || (f === ko && phase !== 19 && phase !== 39)) {
    const fromP1 = phase < 20;
    const t = fromP1 ? phase : phase - 20;
    const sx = fromP1 ? x1 : x2;
    const sy = fromP1 ? y1 : y2;
    const ex = fromP1 ? x2 : x1;
    const ey = fromP1 ? y2 : y1;
    projectiles.push({
      id: `pr${round}-${fromP1 ? 1 : 2}`,
      owner: fromP1 ? "p1" : "p2",
      kind: projectileKind(heroes[fromP1 ? 0 : 1]),
      x: sx + Math.trunc(((ex - sx) * t) / 19),
      y: sy + Math.trunc(((ey - sy) * t) / 19),
    });
  }
  return {
    tick: frame * 6,
    viewerId: "display",
    payload: {
      arena: { w: 16000, h: 9000 },
      entities: [
        { id: "p1", hero: heroes[0], x: x1, y: y1, hp: hp1, maxHp: MAX_HP, facing: 0 },
        { id: "p2", hero: heroes[1], x: x2, y: y2, hp: hp2, maxHp: MAX_HP, facing: 180 },
      ],
      projectiles,
    },
  };
}
