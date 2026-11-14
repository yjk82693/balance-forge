import { wilson95, round6 } from './wilson.js';
import { heroMatchup } from './group.js';
import { fail } from './errors.js';
import { assertMatchResults } from './input-check.js';

export const BAND_LOW = 0.45;
export const BAND_HIGH = 0.55;
export const MIN_GAMES_FOR_OUTLIER = 30; // docs/ui-tone.md: n < 30 suppresses the outlier rule

/** Outlier: whole 95% interval outside the 45-55% band AND n >= 30. */
export function isOutlier(ci95, games) {
  if (games < MIN_GAMES_FOR_OUTLIER) return false;
  return ci95[1] < BAND_LOW || ci95[0] > BAND_HIGH;
}

/** Zero opportunities -> null (unavailable, not 0%). */
export function useRate(row) {
  return row.opportunities > 0 ? row.uses / row.opportunities : null;
}

/** UI hint: n < 30 draws the bar hatched-grey with "Too few games yet". */
export function tooFewGames(row) {
  return row.games < MIN_GAMES_FOR_OUTLIER;
}

// Hero-aware when config.options.assignments exists (addendum 1), else players joined (v0.1).
const defaultDimension = (result) => heroMatchup(result)?.dimension ?? result.config.players.join(' vs ');
const defaultFocal = (result) => heroMatchup(result)?.focal ?? result.config.players[0];

/**
 * MatchResult[] -> Report (contract v0.1).
 * The focal side of a row is the alphabetically first hero (addendum assignments) or players[0]; win rate = focal wins / valid games
 * (draws count as games, not wins). Invalid matches are counted apart and excluded from every rate.
 * options: reportId, botPolicyVersion, seedSetId, dimensionOf(result) -> string, focalOf(result) -> playerId,
 * allowMixed (skip the single-dataHash check; used for human matches, which may span content versions).
 */
export function analyze(results, options = {}) {
  assertMatchResults(results);
  const dimensionOf = options.dimensionOf ?? defaultDimension;
  const focalOf = options.focalOf ?? defaultFocal;
  const valid = results.filter((r) => r.valid === true);
  const invalidMatches = results.length - valid.length;

  const first = valid[0]?.config ?? results[0]?.config;
  if (!first) fail('NO_RESULTS', 'no match results to analyze');
  for (const r of options.allowMixed ? [] : valid) {
    const c = r.config;
    if (c.gameId !== first.gameId || c.simVersion !== first.simVersion || c.dataHash !== first.dataHash) {
      fail('MIXED_DATAHASH', 'results mix gameId, simVersion or dataHash; group them by dataHash first');
    }
  }

  const groups = new Map(); // insertion order = first appearance; sorted below for stable output
  let draws = 0;
  for (const r of valid) {
    const dim = dimensionOf(r);
    let g = groups.get(dim);
    if (!g) groups.set(dim, (g = { wins: 0, games: 0, uses: 0, opportunities: 0 }));
    const focal = focalOf(r);
    g.games += 1;
    if (r.outcome.status === 'draw') draws += 1;
    else if (r.outcome.status === 'win' && r.outcome.winners.includes(focal)) g.wins += 1;
    const ps = r.statistics.players.find((p) => p.playerId === focal);
    for (const a of ps?.actions ?? []) {
      g.uses += a.uses;
      g.opportunities += a.opportunities;
    }
  }

  const rows = [...groups.keys()].sort().map((dimension) => {
    const g = groups.get(dimension);
    const ci95 = wilson95(g.wins, g.games);
    return {
      dimension,
      wins: g.wins,
      games: g.games,
      winRate: round6(g.wins / g.games),
      ci95,
      uses: g.uses,
      opportunities: g.opportunities,
      outlier: isOutlier(ci95, g.games),
    };
  });

  return {
    reportId: options.reportId ?? 'report',
    gameId: first.gameId,
    simVersion: first.simVersion,
    dataHash: first.dataHash,
    botPolicyVersion: options.botPolicyVersion ?? 'unknown',
    seedSetId: options.seedSetId ?? 'unknown',
    validMatches: valid.length,
    invalidMatches,
    draws,
    rows,
  };
}
