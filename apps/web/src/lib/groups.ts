import type { ReportRow } from "./contract";

const HUMAN_PREFIX = /^human:\s*/i;

/** Rows named "human: a vs b" are human matches: a separate group, and a, b are player names, never heroes. */
export const isHumanDimension = (dimension: string) => HUMAN_PREFIX.test(dimension);
export const humanLabel = (dimension: string) => dimension.replace(HUMAN_PREFIX, "");

/** "9–3 (n=12)": wins, losses (every other game) and games, so a small sample still shows its numbers. */
export const recordText = (wins: number, games: number): string =>
  `${wins}–${Math.max(0, games - wins)} (n=${games})`;

/** "bari vs bari": a hero against itself. */
export const isMirror = (dimension: string) => {
  const [a, b] = dimension.split(" vs ");
  return !isHumanDimension(dimension) && b !== undefined && a === b;
};

/**
 * Bot rows for charts. A mirror matchup counts every game as a win for "the hero", so it only shows when the server
 * sent `seatWins` (games won by the first seat), and then that is the win count. Human rows are not in here.
 */
export function botRows(rows: ReportRow[]): ReportRow[] {
  return rows
    .filter((r) => !isHumanDimension(r.dimension))
    .filter((r) => !isMirror(r.dimension) || r.seatWins !== undefined)
    .map((r) => (isMirror(r.dimension) ? { ...r, wins: r.seatWins ?? r.wins } : r));
}

export const humanRows = (rows: ReportRow[]): ReportRow[] => rows.filter((r) => isHumanDimension(r.dimension));
