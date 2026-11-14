import type { MatchRow } from "../components/MatchesTable";
import type { RowStats } from "../components/WinRateChart";
import type { PlaytestRun, VerdictKind } from "./api";
import { fixtureMatchEnded, fixtureMatchResults, fixtureObservation, fixtureRoomStatus } from "./fixtures";
import { heroName } from "./heroes";

export const MATCHES = 1000;
const RUN_KEY = "bf-last-run";
const THEME_KEY = "bf-theme";

export type Theme = "dark" | "light";

export const n = (x: number) => x.toLocaleString("en-US");
export const fmtSeconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the theme just won't persist */
  }
}

/** The last live run, if it is still there and still has the shape we need. */
export function loadRun(): PlaytestRun | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    const run = raw ? (JSON.parse(raw) as PlaytestRun) : null;
    return run && Array.isArray(run.baseline?.rows) ? run : null;
  } catch {
    return null;
  }
}

export function saveRun(run: PlaytestRun) {
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    /* too big or blocked: the run stays in memory only */
  }
}

export const VERDICT_COPY: Record<VerdictKind, { label: string; cls: string; glyph: string }> = {
  accepted: { label: "Accepted", cls: "ok", glyph: "" },
  rejected: { label: "Rejected", cls: "bad", glyph: "" },
  inconclusive: { label: "Inconclusive", cls: "warn", glyph: "▲ " },
};

// ---- sample match rows (?mock=1): the human row is the match from the WebSocket fixture ----

export const SAMPLE_HUMAN_ID = fixtureMatchEnded.payload.result.matchId;
const heroesBySeat = Object.fromEntries(fixtureObservation.payload.entities.map((e) => [e.id, e.hero]));
const namesBySeat: Record<string, string> = Object.fromEntries(
  fixtureRoomStatus.payload.seats.map((s) => [s.seat, s.name]),
);

export const sampleRows: MatchRow[] = fixtureMatchResults.map((result) => {
  const human = result.matchId === SAMPLE_HUMAN_ID;
  return { result, human, heroes: human ? heroesBySeat : {}, names: human ? namesBySeat : {} };
});

// ---- report reading ----

const distanceFromHalf = (s: RowStats) => Math.abs(s.rate - 0.5);

/** Outliers first, then the most lopsided matchups. */
export function outliersFirst(stats: RowStats[]): RowStats[] {
  return [...stats].sort((a, b) => Number(b.outlier) - Number(a.outlier) || distanceFromHalf(b) - distanceFromHalf(a));
}

/**
 * The matchup the story is about: the baseline's worst outlier, else its most lopsided row. Rows with too few games
 * are never picked (their rate says nothing yet); if every row is that small there is no target.
 */
export function pickTargetDimension(baseline: RowStats[]): string | undefined {
  const enough = baseline.filter((s) => !s.small);
  return (enough.find((s) => s.outlier) ?? outliersFirst(enough)[0])?.row.dimension;
}

export function headlineFor(shown: RowStats | undefined): string {
  if (!shown) return "Too few games per matchup yet";
  if (!shown.outlier) return "Within normal range";
  return `${heroName(shown.matchup.a)} wins too often against ${heroName(shown.matchup.b)}`;
}
