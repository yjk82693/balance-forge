// Re-verification: compare the Report before and after a patch (matched seeds, same bot policy).
// Gates from spec: target distance to 50% improves, no NEW extreme matchup above 65% (n >= 200),
// invalid-match rate does not increase. Human acceptance is still required; this is a demo gate.
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
const dist = (row) => Math.abs(row.winRate - 0.5);
const worstSide = (row) => Math.max(row.winRate, 1 - row.winRate);
const invalidRate = (r) => {
  const total = r.validMatches + r.invalidMatches;
  return total === 0 ? 0 : r.invalidMatches / total;
};

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
 * @returns {{verdict: 'accepted'|'rejected'|'inconclusive', reasons: string[], targets: object[]}}
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

  // Hard failures first.
  let rejected = false;
  if (invalidRate(after) > invalidRate(before)) {
    reasons.push('invalid-match rate increased');
    rejected = true;
  }
  for (const row of newExtremeRows(before, after, minGames)) {
    reasons.push(`new extreme matchup: ${row.dimension} at ${Math.round(row.winRate * 100)}%`);
    rejected = true;
  }
  if (rejected) return out('rejected');

  // Target evidence.
  const targets = [];
  let thin = false;
  let notBetter = false;
  for (const dimension of targetDims) {
    const b = beforeBy.get(dimension);
    const a = afterBy.get(dimension);
    if (!b || !a) {
      reasons.push(`${dimension}: missing in ${b ? 'after' : 'before'} report`);
      thin = true;
      continue;
    }
    const improved = dist(a) < dist(b);
    targets.push({ dimension, before: b.winRate, after: a.winRate, ci95After: a.ci95, improved });
    if (a.games < minGames) {
      reasons.push(`${dimension}: only ${a.games} games after patch (need ${minGames})`);
      thin = true;
    } else if (!improved) {
      reasons.push(`${dimension}: distance to 50% did not improve`);
      notBetter = true;
    }
  }
  if (notBetter) return out('rejected', targets);
  if (thin) return out('inconclusive', targets);
  reasons.push('target moved toward 50% with no new extreme matchup and no more invalid matches');
  return out('accepted', targets);
}
