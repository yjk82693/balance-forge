// Re-verification: compare the Report before and after a patch (matched seeds, same bot policy).
// Gates: at least one target moves toward 50% beyond noise, no target moves away beyond noise, no NEW extreme matchup
// above 65% (n >= 200), invalid-match rate does not increase. Human acceptance is still required; this is a demo gate.
export const MIN_GAMES = 200;
export const EXTREME = 0.65;

import { HUMAN_PREFIX } from './extras.js';
import { assertReport } from './input-check.js';

const isBot = (row) => !row.dimension.startsWith(HUMAN_PREFIX); // human rows never gate a patch
// A mirror matchup ("bari vs bari") measures first-seat advantage, which a hero patch cannot fix.
export const isMirror = (row) => {
  const [a, b, ...rest] = row.dimension.split(' vs ');
  return rest.length === 0 && b !== undefined && a === b;
};
const sideOf = (row) => ({ rate: row.winRate, ci95: row.ci95, games: row.games });
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const describe = (row) => `${pct(row.winRate)} [${pct(row.ci95[0])}-${pct(row.ci95[1])}] n=${row.games}`;
// A target "really moved" when it got 5 points closer to (or further from) 50% at n >= minGames (minus float slack).
const SHRINK = 0.05 - 1e-9;
const dist = (row) => Math.abs(row.winRate - 0.5);
const worstSide = (row) => Math.max(row.winRate, 1 - row.winRate);
const invalidRate = (r) => {
  const total = r.validMatches + r.invalidMatches;
  return total === 0 ? 0 : r.invalidMatches / total;
};

/**
 * How one target moved. Both sides are measured against noise, never against a point estimate alone:
 * - improved: at least minGames after the patch, closer to 50%, and either the new 95% interval lies wholly on the
 *   50% side of the old one, or the distance to 50% shrank by at least 5 points;
 * - worse: the same test in the other direction;
 * - unchanged: everything else, including too few games to say.
 */
export function targetOutcome(b, a, minGames = MIN_GAMES) {
  if (a.games < minGames) return 'unchanged';
  const closer = dist(b) - dist(a); // positive: toward 50%
  const above = b.winRate > 0.5;
  const ciToward = above ? a.ci95[1] < b.ci95[0] : a.ci95[0] > b.ci95[1];
  const ciAway = above ? a.ci95[0] > b.ci95[1] : a.ci95[1] < b.ci95[0];
  if (closer > 0 && (ciToward || closer >= SHRINK)) return 'improved';
  if (closer < 0 && (ciAway || -closer >= SHRINK)) return 'worse';
  return 'unchanged';
}

/**
 * Bot rows of `after` that are extreme (a side above 65%, n >= minGames) and were not already extreme on the same side
 * in `before`. Flipping sides counts as new. Mirror rows count too.
 */
export function newExtremeRows(before, after, minGames = MIN_GAMES) {
  const beforeBy = new Map(before.rows.filter(isBot).map((r) => [r.dimension, r]));
  return after.rows.filter(isBot).filter((row) => {
    if (row.games < minGames || worstSide(row) <= EXTREME) return false;
    const prev = beforeBy.get(row.dimension);
    const sameSide = prev && (prev.winRate > 0.5) === (row.winRate > 0.5);
    return !(prev && sameSide && prev.games >= minGames && worstSide(prev) > EXTREME);
  });
}

/**
 * @returns {{verdict: 'accepted'|'rejected'|'inconclusive', reasons: string[], targets: Array<{matchup: string,
 *   before: {rate, ci95, games}, after: {rate, ci95, games}, outcome: 'improved'|'unchanged'|'worse'}>}}
 * options.targets: dimensions to judge; default = non-mirror rows flagged outlier in `before`. Mirror rows are
 * not default targets, but they still count in the "new extreme matchup" check below.
 */
export function judgePatch(before, after, options = {}) {
  assertReport(before, 'before');
  assertReport(after, 'after');
  const minGames = options.minGames ?? MIN_GAMES;
  const reasons = [];
  const out = (verdict, targets = []) => ({ verdict, reasons, targets });

  if (before.gameId !== after.gameId || before.simVersion !== after.simVersion ||
    before.botPolicyVersion !== after.botPolicyVersion) {
    reasons.push('reports are not comparable (gameId, simVersion or botPolicyVersion differ)');
    return out('inconclusive');
  }
  // A holdout run uses fresh seeds on purpose (options.holdoutSeeds); otherwise the seed sets must match.
  if (before.seedSetId !== after.seedSetId && !options.holdoutSeeds) {
    reasons.push('seed sets differ; a matched-seed rerun is required');
    return out('inconclusive');
  }
  if (before.dataHash === after.dataHash) {
    reasons.push('dataHash unchanged; nothing was patched');
    return out('inconclusive');
  }

  const afterBy = new Map(after.rows.filter(isBot).map((r) => [r.dimension, r]));
  const beforeBy = new Map(before.rows.filter(isBot).map((r) => [r.dimension, r]));

  const outliers = before.rows.filter((r) => isBot(r) && r.outlier);
  const targetDims = options.targets ?? outliers.filter((r) => !isMirror(r)).map((r) => r.dimension);
  if (targetDims.length === 0) {
    reasons.push(outliers.length ? 'no target: the only outliers are mirror matchups (first-seat advantage)'
      : 'no target: no outlier in the baseline report');
    return out('inconclusive');
  }

  // Per-target outcome first, so every verdict (also a rejection) says which matchup moved and how.
  const targets = [];
  let thin = false;
  for (const dimension of targetDims) {
    const b = beforeBy.get(dimension);
    const a = afterBy.get(dimension);
    if (!b || !a) {
      reasons.push(`${dimension}: missing in ${b ? 'after' : 'before'} report`);
      thin = true;
      continue;
    }
    const outcome = targetOutcome(b, a, minGames);
    targets.push({ matchup: dimension, before: sideOf(b), after: sideOf(a), outcome });
    reasons.push(`${dimension}: ${outcome} (${describe(b)} -> ${describe(a)})`);
    if (a.games < minGames) {
      reasons.push(`${dimension}: only ${a.games} games after the patch (need ${minGames})`);
      thin = true;
    }
  }

  // Hard failures: more invalid matches, a new extreme matchup, or any target that moved away from 50% beyond noise.
  let rejected = false;
  if (invalidRate(after) > invalidRate(before)) {
    reasons.push('invalid-match rate increased');
    rejected = true;
  }
  for (const row of newExtremeRows(before, after, minGames)) {
    reasons.push(`new extreme matchup: ${row.dimension} at ${Math.round(row.winRate * 100)}%`);
    rejected = true;
  }
  const worse = targets.filter((t) => t.outcome === 'worse');
  if (worse.length) {
    reasons.push(`${worse.length} target(s) moved away from 50% beyond noise`);
    rejected = true;
  }
  if (rejected) return out('rejected', targets);

  const improved = targets.filter((t) => t.outcome === 'improved');
  if (improved.length) {
    reasons.push(`${improved.length} of ${targets.length} target(s) moved toward 50% beyond noise; none moved away, `
      + 'no new extreme matchup and no more invalid matches');
    return out('accepted', targets);
  }
  if (thin) return out('inconclusive', targets);
  reasons.push('no target moved toward 50% beyond noise');
  return out('rejected', targets);
}
