// Human-match rows. Input format (assumed, see REPORT.md): services/room/human-results.json is a
// MatchResult[] (or {results: MatchResult[]}) - the same shape as the match.ended payload.
import { analyze, isOutlier, MIN_GAMES_FOR_OUTLIER } from './analyzer.ts';
import { HUMAN_PREFIX, withExtras } from './extras.ts';
import { assertMatchResults } from './input-check.ts';
import { fail, safely } from './errors.ts';
import { heroMatchup, isCountable } from './group.ts';
import { wilson95, round6 } from './wilson.ts';

export function humanResultsOf(json) {
  const list = Array.isArray(json) ? json : json?.results;
  if (!Array.isArray(list)) fail('INVALID_INPUT', 'human results must be MatchResult[] or {results: MatchResult[]}');
  return assertMatchResults(list, 'human results');
}

/** Appends "human: <matchup>" rows and sets humanMatches (valid human matches). Bot totals are untouched. */
export function addHumanRows(report, humanResults, options: any = {}) {
  const valid = humanResults.filter(isCountable);
  if (valid.length === 0) return withExtras(report, { humanMatches: 0 });
  const human = analyze(valid, { allowMixed: true, ...options });
  const rows = human.rows.map((row) => ({ ...row, dimension: HUMAN_PREFIX + row.dimension }));
  return withExtras({ ...report, rows: [...report.rows, ...rows] }, { humanMatches: valid.length });
}

export const botRows = (report) => report.rows.filter((r) => !r.dimension.startsWith(HUMAN_PREFIX));
export const humanRows = (report) => report.rows.filter((r) => r.dimension.startsWith(HUMAN_PREFIX));

// ---- Human group summary: "Humans: Bari vs Real Armor 4–1 (n=5)" -----------------------------------

/** "real_armor" -> "Real Armor". Unknown ids (e.g. seat ids "p1") pass through readable. */
export const heroDisplayName = (id) =>
  String(id).split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

const pct = (x) => Math.round(x * 100);

/** Honest wording: under 30 games we say it is too few; the outlier flag is never raised there. */
export function smallSampleNote(n) {
  return n === 1
    ? `Only 1 game. Too few to say anything; ${MIN_GAMES_FOR_OUTLIER} or more are needed before a trend counts.`
    : `Only ${n} games. Too few to call a trend; ${MIN_GAMES_FOR_OUTLIER} or more are needed before it counts.`;
}

/**
 * Summary of human matches for the report, one group per matchup (alphabetical hero order).
 * Valid matches only; invalid ones are counted apart. Draws are shown, never split between sides.
 * Returns { ok, value: { humanMatches, invalidMatches, groups } } or an error result.
 */
export const buildHumanGroup = safely((humanResults) => {
  assertMatchResults(humanResults, 'human results');
  const valid = humanResults.filter(isCountable);
  const tally = new Map();
  for (const r of valid) {
    if (!r.config?.players || !r.outcome) fail('INVALID_INPUT', `human match ${r.matchId ?? '?'} is malformed`);
    const m = heroMatchup(r) ?? { dimension: r.config.players.join(' vs '), focal: r.config.players[0] };
    if (!tally.has(m.dimension)) tally.set(m.dimension, { winsA: 0, winsB: 0, draws: 0 });
    const t = tally.get(m.dimension);
    if (r.outcome.status === 'draw') t.draws += 1;
    else if (r.outcome.winners.includes(m.focal)) t.winsA += 1;
    else t.winsB += 1;
  }
  const groups = [...tally.keys()].sort().map((dimension) => {
    const { winsA, winsB, draws } = tally.get(dimension);
    const n = winsA + winsB + draws;
    const [a, b] = dimension.split(' vs ');
    const ci95 = wilson95(winsA, n);
    const smallSample = n < MIN_GAMES_FOR_OUTLIER;
    const drawText = draws ? `, ${draws} draw${draws === 1 ? '' : 's'}` : '';
    return {
      dimension: HUMAN_PREFIX + dimension,
      label: `Humans: ${heroDisplayName(a)} vs ${heroDisplayName(b)} ${winsA}–${winsB}${drawText} (n=${n})`,
      heroes: [a, b],
      winsA, winsB, draws, n,
      winRate: round6(winsA / n),
      ci95,
      smallSample,
      outlier: !smallSample && isOutlier(ci95, n),
      note: smallSample ? smallSampleNote(n) : `95% CI ${pct(ci95[0])}–${pct(ci95[1])}% · n = ${n}`,
    };
  });
  return { humanMatches: valid.length, invalidMatches: humanResults.length - valid.length, groups };
});
