// Human-match rows. Input format (assumed, see REPORT.md): services/room/human-results.json is a
// MatchResult[] (or {results: MatchResult[]}) - the same shape as the match.ended payload.
import { analyze } from './analyzer.js';
import { HUMAN_PREFIX, withExtras } from './extras.js';

export function humanResultsOf(json) {
  const list = Array.isArray(json) ? json : json?.results;
  if (!Array.isArray(list)) throw new TypeError('human results must be MatchResult[] or {results: MatchResult[]}');
  return list;
}

/** Appends "human: <matchup>" rows and sets humanMatches (valid human matches). Bot totals are untouched. */
export function addHumanRows(report, humanResults, options = {}) {
  const valid = humanResults.filter((r) => r.valid === true);
  if (valid.length === 0) return withExtras(report, { humanMatches: 0 });
  const human = analyze(valid, { allowMixed: true, ...options });
  const rows = human.rows.map((row) => ({ ...row, dimension: HUMAN_PREFIX + row.dimension }));
  return withExtras({ ...report, rows: [...report.rows, ...rows] }, { humanMatches: valid.length });
}

export const botRows = (report) => report.rows.filter((r) => !r.dimension.startsWith(HUMAN_PREFIX));
export const humanRows = (report) => report.rows.filter((r) => r.dimension.startsWith(HUMAN_PREFIX));
