import type { MatchResult, Report } from "./contract";
import type { PlaytestRun } from "./api";

interface Metrics {
  matchCount: number;
  validMatches: number;
  invalidMatches: number;
  elapsedMs: number;
  botPolicyVersion: string;
  seedSetId: string;
}

/**
 * The stored run: services/runner/recorded-*.json, an actual measured run (Bari vs Real Armor, seeds 1..100, both seat
 * assignments). Used when the live run fails. Loaded lazily; it's about 350 KB. Wins are counted for Bari: in the
 * first job (m-1) Bari sits in p1, in the seat-swapped variant Bari sits in p2.
 */
export async function loadRecordedRun(): Promise<PlaytestRun> {
  const [results, metrics] = await Promise.all([
    import("../../../../services/runner/recorded-match-results.json").then(
      (m) => m.default as unknown as MatchResult[],
    ),
    import("../../../../services/runner/recorded-metrics.json").then((m) => m.default as unknown as Metrics),
  ]);
  const first = results.find((r) => r.matchId === "m-1") ?? results[0];
  const bariFirst = first.config.dataHash;
  let wins = 0;
  let games = 0;
  let draws = 0;
  for (const r of results) {
    if (!r.valid) continue;
    games += 1;
    if (r.outcome.status === "draw") draws += 1;
    else if (r.outcome.winners[0] === (r.config.dataHash === bariFirst ? "p1" : "p2")) wins += 1;
  }
  const report: Report = {
    reportId: "recorded-runner-sample",
    gameId: first.config.gameId,
    simVersion: first.config.simVersion,
    dataHash: bariFirst,
    botPolicyVersion: metrics.botPolicyVersion,
    seedSetId: metrics.seedSetId,
    validMatches: metrics.validMatches,
    invalidMatches: metrics.invalidMatches,
    draws,
    rows: [{
      dimension: "bari vs real_armor",
      wins,
      games,
      winRate: games ? wins / games : 0,
      ci95: [0, 1],
      uses: 0,
      opportunities: 0,
      outlier: false,
    }],
    elapsedMs: Math.round(metrics.elapsedMs),
    recorded: true,
  };
  return { baseline: report };
}
