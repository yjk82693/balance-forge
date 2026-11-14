import type { Report, ReportRow } from "./contract";
import { isHumanDimension, isMirror } from "./groups";

/** One matchup in `playtest.progress` (services/room README): wins are keyed by hero id. */
export interface MatchupProgress {
  matchup: string;
  heroes: string[];
  wins: Record<string, number>;
  games: number;
  draws: number;
  invalidMatches: number;
  /**
   * Not sent by the server today (see CHANGE_REQUEST.md). For a mirror matchup: games won by the first seat, which is
   * what makes a mirror win rate meaningful.
   */
  seatWins?: number;
}

/** `playtest.progress` payload as the room server sends it. */
export interface ProgressMsg {
  runId?: string;
  gameId?: string;
  /** "baseline" on the data as it is, then "holdout" on the patched data (POST /v1/playtest/full) */
  phase?: "baseline" | "holdout";
  dataHash?: string;
  matchesDone: number;
  totalMatches: number;
  elapsedMs?: number;
  matchups: MatchupProgress[];
}

/** Wire shape check; per-matchup rows are checked when they are turned into chart rows. */
export function isProgressMsg(p: unknown): p is ProgressMsg {
  const m = p as ProgressMsg;
  return !!m && Number.isFinite(m.matchesDone) && Number.isFinite(m.totalMatches) && Array.isArray(m.matchups);
}

/**
 * A mirror matchup (hero vs itself) has one win counter for both seats, so every decided game counts as a win for
 * "the hero". That is not a win rate; such rows are left out unless the server reports seat-based wins (`seatWins`).
 */
const isMirrorWithoutSeats = (m: MatchupProgress) =>
  isMirror(`${m.heroes[0]} vs ${m.heroes[1]}`) && m.seatWins === undefined;

/** Rows for the chart: win rate of the first-named hero (the server sorts hero ids alphabetically). */
export function toRows(p: ProgressMsg): ReportRow[] {
  return p.matchups
    .filter((m) => !isHumanDimension(m.matchup) && m.heroes?.length === 2 && !isMirrorWithoutSeats(m))
    .map((m) => {
      const wins = m.seatWins ?? m.wins?.[m.heroes[0]] ?? 0;
      return {
        dimension: `${m.heroes[0]} vs ${m.heroes[1]}`,
        wins,
        games: m.games,
        winRate: m.games ? wins / m.games : 0,
        ci95: [0, 1],
        uses: 0,
        opportunities: 0,
        outlier: false,
      };
    });
}

function xorshift32(x: number): number {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/**
 * Mock progress for ?mock=1, in the server's message shape. Counts grow monotonically toward the final report's
 * wins/games with a noise term that shrinks to zero, so the last tick equals the stored report exactly.
 * Deterministic (seeded), integers only.
 */
export function mockProgress(
  final: Report,
  onTick: (p: ProgressMsg) => void,
  opts: { steps?: number; stepMs?: number; phase?: "baseline" | "holdout" } = {},
): () => void {
  const steps = opts.steps ?? 50;
  const total = final.validMatches;
  let s = 20261113;
  const prev = final.rows.map(() => ({ wins: 0, games: 0 }));
  let i = 0;
  const tick = () => {
    i += 1;
    const f = i / steps;
    const matchups = final.rows.map((r, k): MatchupProgress => {
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
      const [a, b] = r.dimension.split(" vs ");
      return {
        matchup: r.dimension,
        heroes: [a, b ?? a],
        wins: { [a]: wins },
        games,
        draws: 0,
        invalidMatches: 0,
        seatWins: wins,
      };
    });
    onTick({
      phase: opts.phase,
      matchesDone: i === steps ? total : Math.round((total * i) / steps),
      totalMatches: total,
      matchups,
    });
    if (i >= steps) clearInterval(timer);
  };
  const timer = setInterval(tick, opts.stepMs ?? 110);
  return () => clearInterval(timer);
}
