// Evidence for outlier rows, from statistics the engine already records: per action use rate and opportunities, and the
// damage share of each side. Not available yet: damage per move and hits that went through a guard (statistics only
// carry total damage per player). Those stay `null` and are listed in `missing`; nothing is estimated. See
// CHANGE_REQUEST.md (engine item) for the fields that would add them.
import { assertMatchResults, assertReport } from './input-check.js';
import { heroMatchup, isCountable } from './group.js';
import { HUMAN_PREFIX } from './extras.js';
import { safely } from './errors.js';
import { round6 } from './wilson.js';

export const MISSING_FIELDS = ['damageByAction', 'hitsThroughGuard'];

const rate = (part, whole) => (whole > 0 ? round6(part / whole) : null);

const newSide = (hero) => ({ hero, damage: 0, actions: new Map() });

function addSide(side, stats) {
  side.damage += stats?.damage ?? 0;
  for (const a of stats?.actions ?? []) {
    const total = side.actions.get(a.actionId) ?? { opportunities: 0, uses: 0 };
    total.opportunities += a.opportunities;
    total.uses += a.uses;
    side.actions.set(a.actionId, total);
  }
}

function finishSide(side, totalDamage) {
  const actions = [...side.actions.keys()].sort().map((actionId) => {
    const { opportunities, uses } = side.actions.get(actionId);
    return { actionId, opportunities, uses, useRate: rate(uses, opportunities), damage: null };
  });
  return { hero: side.hero, damage: side.damage, damageShare: rate(side.damage, totalDamage), actions };
}

/**
 * One evidence block per bot outlier row of `report`, built from the same counted matches the report used.
 * Returns { ok: true, value: { missing, rows } } or an error result. `focal` is the row's focal side (alphabetically
 * first hero); `other` is its opponent (the same hero in a mirror row).
 */
export const buildEvidence = safely((countedResults, report) => {
  assertMatchResults(countedResults);
  assertReport(report);
  const wanted = new Map(report.rows.filter((r) => !r.dimension.startsWith(HUMAN_PREFIX) && r.outlier)
    .map((r) => [r.dimension, r]));
  const blocks = new Map();
  for (const result of countedResults.filter(isCountable)) {
    const matchup = heroMatchup(result);
    if (!matchup || !wanted.has(matchup.dimension)) continue;
    const assignments = result.config.options.assignments;
    const otherId = result.config.players.find((p) => p !== matchup.focal);
    let block = blocks.get(matchup.dimension);
    if (!block) {
      block = { focal: newSide(assignments[matchup.focal]), other: newSide(assignments[otherId]), games: 0 };
      blocks.set(matchup.dimension, block);
    }
    block.games += 1;
    const byPlayer = (id) => result.statistics.players.find((p) => p.playerId === id);
    addSide(block.focal, byPlayer(matchup.focal));
    addSide(block.other, byPlayer(otherId));
  }
  const rows = [...blocks.keys()].sort().map((dimension) => {
    const { focal, other, games } = blocks.get(dimension);
    const row = wanted.get(dimension);
    const totalDamage = focal.damage + other.damage;
    return { dimension, games, winRate: row.winRate, ci95: row.ci95, mirror: focal.hero === other.hero,
      focal: finishSide(focal, totalDamage), other: finishSide(other, totalDamage) };
  });
  return { missing: MISSING_FIELDS, rows };
});
