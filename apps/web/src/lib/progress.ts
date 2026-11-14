import type { Report, ReportRow } from "./contract";

/** WebSocket topic message `playtest.progress`: cumulative counts so far. `rows` is optional on the wire. */
export interface ProgressMsg {
  done: number;
  total: number;
  rows?: { dimension: string; wins: number; games: number }[];
}

export const toRows = (p: ProgressMsg): ReportRow[] | null =>
  p.rows?.map((r) => ({
    dimension: r.dimension,
    wins: r.wins,
    games: r.games,
    winRate: r.games ? r.wins / r.games : 0,
    ci95: [0, 1],
    uses: 0,
    opportunities: 0,
    outlier: false,
  })) ?? null;

function xorshift32(x: number): number {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/**
 * Mock progress for ?mock=1: counts grow monotonically toward the final report's wins/games with a noise term that
 * shrinks to zero, so the last tick equals the stored report exactly. Deterministic (seeded), integers only.
 */
export function mockProgress(
  final: Report,
  onTick: (p: ProgressMsg) => void,
  opts: { steps?: number; stepMs?: number } = {},
): () => void {
  const steps = opts.steps ?? 50;
  const total = final.validMatches;
  let s = 20261113;
  const prev = final.rows.map(() => ({ wins: 0, games: 0 }));
  let i = 0;
  const tick = () => {
    i += 1;
    const f = i / steps;
    const rows = final.rows.map((r, k) => {
      const games = i === steps ? r.games : Math.round((r.games * i) / steps);
      let wins = i === steps ? r.wins : Math.round((r.wins * i) / steps);
      if (i < steps) {
        s = xorshift32(s);
        const amp = Math.round(Math.sqrt(games) * (1 - f) * 1.2);
        wins += (s % (2 * amp + 1)) - amp;
      }
      const p = prev[k];
      // monotonic: never fewer wins/losses than before, never more wins than games
      wins = Math.max(p.wins, Math.min(wins, games - (p.games - p.wins)));
      wins = Math.min(wins, games);
      prev[k] = { wins, games };
      return { dimension: r.dimension, wins, games };
    });
    onTick({ done: i === steps ? total : Math.round((total * i) / steps), total, rows });
    if (i >= steps) clearInterval(timer);
  };
  const timer = setInterval(tick, opts.stepMs ?? 110);
  return () => clearInterval(timer);
}
