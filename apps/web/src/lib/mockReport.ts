import type { Report, ReportRow } from "./contract";
import { HEROES } from "./heroes";
import { fixtureReportBaseline } from "./fixtures";
import type { Version } from "./replayGen";

/**
 * Sample data for ?mock=1 only: 15 matchups (5 heroes, mirror matches included), 1,000 games in total.
 * Win counts are hand-picked around the fixture's 79% Bari vs Real Armor story. Never shown as results.
 */
const WINS: Record<string, number> = {
  "bari vs bari": 34,
  "bari vs real_armor": 53,
  "bari vs daewi": 35,
  "bari vs sepia": 33,
  "bari vs nightcrow": 38,
  "real_armor vs real_armor": 33,
  "real_armor vs daewi": 31,
  "real_armor vs sepia": 32,
  "real_armor vs nightcrow": 34,
  "daewi vs daewi": 33,
  "daewi vs sepia": 35,
  "daewi vs nightcrow": 30,
  "sepia vs sepia": 34,
  "sepia vs nightcrow": 33,
  "nightcrow vs nightcrow": 33,
};
const PATCHED_WINS: Record<string, number> = { "bari vs real_armor": 36 };

export function mockReport(version: Version): Report {
  const ids = HEROES.map((h) => h.id);
  const dims: string[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i; j < ids.length; j++) dims.push(`${ids[i]} vs ${ids[j]}`);
  const rows: ReportRow[] = dims.map((dimension, i) => {
    const games = i < 10 ? 67 : 66;
    const wins = (version === "patched" ? PATCHED_WINS[dimension] : undefined) ?? WINS[dimension];
    return { dimension, wins, games, winRate: wins / games, ci95: [0, 1], uses: 0, opportunities: 0, outlier: false };
  });
  return {
    ...fixtureReportBaseline,
    reportId: `sample-${version}`,
    dataHash: version === "patched" ? "c".repeat(64) : "a".repeat(64),
    validMatches: 1000,
    invalidMatches: 0,
    draws: 6,
    seedSetId: "sample-pairs",
    rows,
  };
}
