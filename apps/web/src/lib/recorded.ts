import type { MatchResult, Report } from "./contract";
import type { PlaytestRun } from "./api";
import { runFromFull } from "./fullRun";
import { reportFromResults } from "./reportFromResults";

interface Metrics {
  matchCount: number;
  validMatches: number;
  invalidMatches: number;
  elapsedMs: number;
  botPolicyVersion: string;
  seedSetId: string;
  dataHash?: string;
}

// Stored runs live in services/runner (read-only for the web). A glob, so a file that is not there yet is simply absent
// instead of breaking the build. Each file is its own lazy chunk.
const stored = import.meta.glob("../../../../services/runner/recorded-*.json", { import: "default" });
const storedFile = (name: string) =>
  Object.entries(stored).find(([path]) => path.endsWith(`/${name}`))?.[1] as (() => Promise<unknown>) | undefined;

/**
 * The stored run, best source first:
 * 1. recorded-roster-report.json: a finished report (real intervals) or a whole /full response.
 * 2. recorded-roster-match-results.json + metrics: the 15-matchup roster run, turned into a report here.
 * 3. recorded-match-results.json + metrics: the older Bari vs Real Armor run.
 */
export async function loadRecordedRun(): Promise<PlaytestRun> {
  const report = storedFile("recorded-roster-report.json");
  if (report) {
    const run = runFromFull(await report());
    if (run) return { ...run, baseline: { ...run.baseline, recorded: true } };
  }
  const results = storedFile("recorded-roster-match-results.json");
  const metrics = storedFile("recorded-roster-metrics.json");
  if (results && metrics) {
    const [rows, m] = (await Promise.all([results(), metrics()])) as [MatchResult[], Metrics];
    if (Array.isArray(rows) && rows.length > 0) return { baseline: rosterReport(rows, m) };
  }
  return loadOlderRun();
}

function rosterReport(results: MatchResult[], m: Metrics): Report {
  const report = reportFromResults(results, {
    resultsPath: "recorded-roster-match-results.json",
    elapsedMs: m.elapsedMs,
    matchCount: results.length,
    dataHash: m.dataHash ?? results[0].config.dataHash,
    recorded: true,
  });
  return { ...report, botPolicyVersion: m.botPolicyVersion ?? report.botPolicyVersion, seedSetId: m.seedSetId };
}

/**
 * The older stored run: an actual measured run (Bari vs Real Armor, seeds 1..100, both seat assignments).
 * Wins are counted for Bari: in the first job (m-1) Bari sits in p1, in the seat-swapped variant in p2.
 */
async function loadOlderRun(): Promise<PlaytestRun> {
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
