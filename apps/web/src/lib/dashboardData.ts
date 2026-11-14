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
export function loadRun(game = "hero_arena"): PlaytestRun | null {
  try {
    const raw = sessionStorage.getItem(game === "hero_cards" ? `${RUN_KEY}-cards` : RUN_KEY);
    const run = raw ? (JSON.parse(raw) as PlaytestRun) : null;
    return run && Array.isArray(run.baseline?.rows) ? run : null;
  } catch {
    return null;
  }
}

/** Kept per game: a Hero Cards run never replaces the Hero Arena run, and the other way round. */
export function saveRun(run: PlaytestRun) {
  try {
    const cards = run.baseline.gameId === "hero_cards";
    sessionStorage.setItem(cards ? `${RUN_KEY}-cards` : RUN_KEY, JSON.stringify(run));
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

const distanceFromTarget = (s: RowStats) => Math.abs(s.rate - s.target.rate);

/** Outliers first, then the matchups furthest from what the designer intends. */
export function outliersFirst(stats: RowStats[]): RowStats[] {
  const away = distanceFromTarget;
  return [...stats].sort((a, b) => Number(b.outlier) - Number(a.outlier) || away(b) - away(a));
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
  const { a, b } = shown.matchup;
  if (!shown.outlier) return shown.target.favored ? "As intended" : "Within normal range";
  // above the band the hero named first wins too often; below it, the other one does
  return shown.rate > shown.target.rate
    ? `${heroName(a)} wins too often against ${heroName(b)}`
    : `${heroName(b)} wins too often against ${heroName(a)}`;
}
