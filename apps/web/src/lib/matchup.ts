import type { PlaytestRun } from "./api";
import { rowStats, parseMatchup } from "../components/WinRateChart";
import { outliersFirst } from "./dashboardData";
import { botRows, isMirror } from "./groups";
import type { JustPlayed } from "./justPlayed";

/** Two different heroes: the matchup a live run measures. */
export type Matchup = [string, string];

/** What the live run measured before a choice is made. */
export const FALLBACK_MATCHUP: Matchup = ["bari", "real_armor"];

const KEY = "bf-matchup";

const valid = (m: unknown): m is Matchup =>
  Array.isArray(m) && m.length === 2 && typeof m[0] === "string" && typeof m[1] === "string" && m[0] !== m[1];

export function loadChosen(): Matchup | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return valid(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveChosen(m: Matchup) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage blocked: the choice lasts until the page is left */
  }
}

/** The two heroes of the match a person just played, unless both played the same hero. */
export function playedMatchup(played: JustPlayed | null): Matchup | null {
  const heroes = Object.values(played?.heroes ?? {});
  return heroes.length === 2 && heroes[0] !== heroes[1] ? [heroes[0], heroes[1]] : null;
}

/** The most lopsided outlier (no mirror matchups) of the stored roster report; null if there is none. */
export function largestOutlier(roster: PlaytestRun | null): Matchup | null {
  if (!roster) return null;
  const stats = botRows(roster.baseline.rows).filter((r) => !isMirror(r.dimension)).map(rowStats);
  const top = outliersFirst(stats.filter((s) => s.outlier))[0];
  if (!top) return null;
  const m = parseMatchup(top.row.dimension);
  return m.a !== m.b && m.b ? [m.a, m.b] : null;
}

/** The match just played, else the largest outlier of the recorded roster report, else the old fixed pair. */
export function defaultMatchup(played: JustPlayed | null, roster: PlaytestRun | null): Matchup {
  return playedMatchup(played) ?? largestOutlier(roster) ?? FALLBACK_MATCHUP;
}

/** A person's pick if they made one, else the default. Used by the dashboard and the presenter alike. */
export function currentMatchup(played: JustPlayed | null, roster: PlaytestRun | null): Matchup {
  return loadChosen() ?? defaultMatchup(played, roster);
}
