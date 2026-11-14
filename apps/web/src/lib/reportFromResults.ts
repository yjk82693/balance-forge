import type { MatchResult, Report, ReportRow } from "./contract";

/** What POST /v1/playtest/run returns (services/room README). */
export interface RunInfo {
  resultsPath: string;
  elapsedMs: number;
  matchCount: number;
  dataHash: string;
  recorded: boolean;
}

interface Tally {
  heroes: [string, string];
  wins: number;
  games: number;
}

/**
 * Builds a Report from the run's MatchResult[]: one row per hero pair, win rate of the alphabetically first hero
 * (the server's naming). Seat assignments come from `config.options.assignments`. Mirror matchups are left out:
 * the hero's win count cannot be split by seat. Invalid matches are counted apart, never as draws.
 */
export function reportFromResults(results: MatchResult[], info: RunInfo): Report {
  const tallies = new Map<string, Tally>();
  let invalid = 0;
  let draws = 0;
  for (const r of results) {
    if (!r.valid) {
      invalid += 1;
      continue;
    }
    const assign = r.config.options?.assignments;
    const names = r.config.players.map((id) => assign?.[id] ?? id).sort();
    if (names.length !== 2) continue;
    if (r.outcome.status === "draw") draws += 1;
    if (names[0] === names[1]) continue;
    const key = names.join(" vs ");
    const t = tallies.get(key) ?? { heroes: [names[0], names[1]] as [string, string], wins: 0, games: 0 };
    t.games += 1;
    if (r.outcome.winners.some((w) => (assign?.[w] ?? w) === t.heroes[0])) t.wins += 1;
    tallies.set(key, t);
  }
  const rows: ReportRow[] = [...tallies.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([dimension, t]) => ({
      dimension,
      wins: t.wins,
      games: t.games,
      winRate: t.games ? t.wins / t.games : 0,
      ci95: [0, 1],
      uses: 0,
      opportunities: 0,
      outlier: false,
    }));
  const first = results[0];
  return {
    reportId: info.resultsPath.split("/").pop()?.replace(".json", "") ?? "run",
    gameId: first?.config.gameId ?? "hero_arena",
    simVersion: first?.config.simVersion ?? "unknown",
    dataHash: info.dataHash,
    botPolicyVersion: "scripted",
    seedSetId: `pairs-${Math.round(results.length / 2)}`,
    validMatches: results.length - invalid,
    invalidMatches: invalid,
    draws,
    rows,
    elapsedMs: Math.round(info.elapsedMs),
    recorded: info.recorded === true,
  };
}
