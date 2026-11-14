// Roster matchup table: N heroes -> N x N cells, N*(N+1)/2 distinct matchups (mirrors included).
// Built from results (not Report rows) because both sides of a matchup need their own win count.
// Outlier rule is unchanged: n >= 30 and the whole 95% interval outside 45-55%.
import { wilson95, round6 } from './wilson.js';
import { isOutlier, tooFewGames } from './analyzer.js';
import { heroMatchup, isCountable } from './group.js';
import { fail, safely } from './errors.js';

const cell = (row, col, dimension, mirror, wins, losses, draws) => {
  const games = wins + losses + draws;
  const ci95 = wilson95(wins, games);
  const c = { row, col, dimension, mirror, wins, losses, draws, games, winRate: games ? round6(wins / games) : 0,
    ci95, outlier: isOutlier(ci95, games) };
  c.tooFewGames = tooFewGames(c);
  return c;
};

/**
 * results: valid, already-paired MatchResults carrying config.options.assignments.
 * options.roster: hero ids in display order (default = sorted heroes seen). Heroes outside it are an error.
 * Mirror cells (hero vs itself): "wins" = seat-1 wins, i.e. the seat advantage.
 * Returns { roster, expected, matchups, cells, missing } via safely: { ok, value } or an error result.
 */
export const buildMatchupTable = safely((results, options = {}) => {
  if (!Array.isArray(results)) fail('INVALID_INPUT', 'results must be an array');
  const tally = new Map(); // "a|b" with a <= b -> { aWins, bWins, draws }
  const seen = new Set();
  for (const r of results) {
    if (!isCountable(r)) continue;
    const m = heroMatchup(r);
    if (!m) fail('INVALID_INPUT', `match ${r.matchId ?? '?'} has no hero assignments (config.options.assignments)`);
    const [a, b] = m.dimension.split(' vs ');
    seen.add(a); seen.add(b);
    const key = `${a}|${b}`;
    if (!tally.has(key)) tally.set(key, { aWins: 0, bWins: 0, draws: 0 });
    const t = tally.get(key);
    if (r.outcome.status === 'draw') t.draws += 1;
    else if (r.outcome.status === 'win') {
      if (r.outcome.winners.includes(m.focal)) t.aWins += 1;
      else t.bWins += 1;
    }
  }
  const roster = options.roster ? [...options.roster] : [...seen].sort();
  if (new Set(roster).size !== roster.length) fail('INVALID_INPUT', 'roster has duplicate heroes');
  const unknown = [...seen].filter((h) => !roster.includes(h));
  if (unknown.length) fail('INVALID_INPUT', `heroes not in roster: ${unknown.join(', ')}`);

  const keyOf = (x, y) => (x <= y ? `${x}|${y}` : `${y}|${x}`);
  const at = (x, y) => {
    const t = tally.get(keyOf(x, y));
    if (!t) return null;
    if (x === y) return cell(x, y, `${x} vs ${y}`, true, t.aWins, t.bWins, t.draws);
    const first = x < y; // tally orients alphabetically: a = smaller id
    return cell(x, y, first ? `${x} vs ${y}` : `${y} vs ${x}`, false, first ? t.aWins : t.bWins, first ? t.bWins :
      t.aWins, t.draws);
  };
  const cells = roster.map((x) => roster.map((y) => at(x, y)));

  // Distinct matchups in alphabetical orientation (these match the Report rows).
  const sorted = [...roster].sort();
  const matchups = [];
  const missing = [];
  sorted.forEach((x, i) => {
    for (const y of sorted.slice(i)) {
      const c = at(x, y);
      if (c) matchups.push(c);
      else missing.push(`${x} vs ${y}`);
    }
  });
  return { roster, expected: (roster.length * (roster.length + 1)) / 2, matchups, cells, missing };
});
