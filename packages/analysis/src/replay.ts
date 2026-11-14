// Before/after replay of the most lopsided baseline match (same seed, same bot policy) on patched data.
// The simulator is injected, so this module has no engine dependency and no I/O.
//
// simulate({ config, data }) -> {
//   outcome, finalStateHash, durationTicks,
//   heroes: { p1: 'bari', ... }, maxHp: { p1: 540, ... },
//   timeline: [{ tick, hp: { p1: 540, p2: 700 } }]   // on-change samples, first = tick 0, last = final tick
// }
import { analyze } from './analyzer.ts';
import { heroMatchup, isCountable } from './group.ts';
import { validatePatch } from './validator.ts';
import { fail, safely } from './errors.ts';

/** Pure: returns patched GameData or throws AnalysisError (wrap with safely). */
export function applyPatchToData(data, proposal, { hashData, rootData = data }: any = {}) {
  const check = validatePatch(proposal, { rootData });
  if (!check.ok) fail('INVALID_PATCH', check.errors.join('; '), check.errors);
  if (hashData && proposal.baseDataHash !== hashData(data)) {
    fail('PATCH_BASE_MISMATCH', 'patch baseDataHash does not match the data it is applied to');
  }
  const out = structuredClone(data);
  for (const { path, value } of proposal.replacements) {
    const stat = /^\/characters\/(\d+)\/(health|speed)$/.exec(path);
    const card = /^\/gameRules\/cards\/(\d+)\/(cost|power)$/.exec(path);
    if (path === '/tuning/damageScalePermille') {
      if (!out.tuning) fail('PATCH_PATH_MISSING', 'data has no tuning section');
      out.tuning.damageScalePermille = value;
    } else if (card) {
      if (!out.gameRules?.cards?.[Number(card[1])]) fail('PATCH_PATH_MISSING', `data has no card ${card[1]}`);
      out.gameRules.cards[Number(card[1])][card[2]] = value;
    } else if (stat) {
      if (!out.characters?.[Number(stat[1])]) fail('PATCH_PATH_MISSING', `data has no character ${stat[1]}`);
      out.characters[Number(stat[1])][stat[2]] = value;
    } else {
      const index = Number(path.split('/')[2]);
      if (!out.moves?.[index]) fail('PATCH_PATH_MISSING', `data has no move ${index}`);
      out.moves[index].power = value;
    }
  }
  return out;
}

/**
 * Resolve matchup label and focal seat for any result: hero assignments (addendum), else the seat
 * heroes of the pinned data variant (v0.1 runner), else the players joined.
 * seatsByHash: Map(dataHash -> [heroForSeat0, heroForSeat1]).
 */
export function matchupResolver(seatsByHash = new Map()) {
  const resolve = (result) => {
    const m = heroMatchup(result);
    if (m) return m;
    const seats = seatsByHash.get(result.config.dataHash);
    if (seats && seats.length === result.config.players.length) {
      const order = result.config.players.map((p, i) => ({ player: p, hero: seats[i] }));
      order.sort((a, b) => (a.hero < b.hero ? -1 : a.hero > b.hero ? 1 : a.player < b.player ? -1 : 1));
      return { dimension: order.map((o) => o.hero).join(' vs '), focal: order[0].player };
    }
    return { dimension: result.config.players.join(' vs '), focal: result.config.players[0] };
  };
  return { dimensionOf: (r) => resolve(r).dimension, focalOf: (r) => resolve(r).focal };
}

const damageOf = (result, player) => result.statistics.players.find((p) => p.playerId === player)?.damage ?? 0;

/**
 * Most lopsided matchup = largest |winRate - 50%|; the match = the most one-sided win by its dominant
 * side (largest damage margin, then shorter, then lower seed, then matchId). Deterministic.
 * options: dimensionOf, focalOf, dataHash (only consider matches pinned to this content version).
 */
export const pickLopsidedMatch = safely((results, options: any = {}) => {
  const pool = options.dataHash ? results.filter((r) => r.config.dataHash === options.dataHash) : results;
  const report = analyze(pool, { ...options, allowMixed: true });
  const played = report.rows.filter((r) => r.games > 0);
  if (played.length === 0) fail('NO_RESULTS', 'no valid matches to pick from');
  // A mirror matchup only measures the first-seat advantage, not hero balance: use it only if nothing else exists.
  const isMirror = (r) => { const [a, b] = r.dimension.split(' vs '); return a === b; };
  const rows = played.some((r) => !isMirror(r)) ? played.filter((r) => !isMirror(r)) : played;
  rows.sort((a, b) => Math.abs(b.winRate - 0.5) - Math.abs(a.winRate - 0.5) || (a.dimension < b.dimension ? -1 : 1));
  const row = rows[0];
  const focalDominates = row.winRate >= 0.5;
  const dimensionOf = options.dimensionOf ?? ((r) => heroMatchup(r)?.dimension ?? r.config.players.join(' vs '));
  const focalOf = options.focalOf ?? ((r) => heroMatchup(r)?.focal ?? r.config.players[0]);
  const candidates = pool.filter((r) => {
    if (!isCountable(r) || r.outcome.status !== 'win' || dimensionOf(r) !== row.dimension) return false;
    const focalWon = r.outcome.winners.includes(focalOf(r));
    return focalWon === focalDominates;
  });
  if (candidates.length === 0) fail('NO_DECISIVE_MATCH',
    `no decisive match won by the dominant side in "${row.dimension}"`);
  const margin = (r) => damageOf(r,
    r.outcome.winners[0]) - r.statistics.players.filter((p) => p.playerId !== r.outcome.winners[0]).reduce((n,
    p) => n + p.damage, 0);
  candidates.sort((a, b) => margin(b) - margin(a) || a.statistics.durationTicks - b.statistics.durationTicks ||
    a.config.seed - b.config.seed || (a.matchId < b.matchId ? -1 : 1));
  const result = candidates[0];
  return { result, dimension: row.dimension, matchupWinRate: row.winRate, matchupGames: row.games,
    margin: margin(result) };
});

function checkSim(out, label) {
  const ok = out && Array.isArray(out.timeline) && out.timeline.length >= 1 && out.outcome &&
    typeof out.finalStateHash === 'string';
  if (!ok) fail('SIMULATION_FAILED', `${label}: simulator returned an invalid result`);
  return out;
}

const side = (dataHash, sim) => ({
  dataHash,
  outcome: sim.outcome,
  durationTicks: sim.durationTicks,
  finalStateHash: sim.finalStateHash,
  maxHp: sim.maxHp,
  timeline: sim.timeline,
});

/**
 * Re-simulates the baseline match twice: unchanged data (must reproduce the recorded hash, which
 * proves determinism and the same bot policy) and patched data. Returns JSON the web can render
 * side by side, or an error result.
 */
export const buildBeforeAfter = safely(({ baselineResult, selection, baseData, proposal, simulate, hashData }) => {
  if (typeof simulate !== 'function' || typeof hashData !== 'function') fail('INVALID_INPUT',
    'simulate and hashData are required');
  if (!baselineResult?.config) fail('INVALID_INPUT', 'baselineResult is missing');
  if (proposal?.baseDataHash !== baselineResult.config.dataHash) {
    fail('PATCH_BASE_MISMATCH', 'the patch was made for a different dataHash than this match used');
  }
  if (hashData(baseData) !== baselineResult.config.dataHash) {
    fail('DATA_HASH_MISMATCH', 'base data does not hash to the match dataHash');
  }
  const patched = applyPatchToData(baseData, proposal, { hashData });
  const run = (config, data, label) => {
    try {
      return checkSim(simulate({ config, data }), label);
    } catch (e) {
      if (e?.name === 'AnalysisError') throw e;
      return fail('SIMULATION_FAILED', `${label}: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  };
  const before = run(baselineResult.config, baseData, 'before');
  if (before.finalStateHash !== baselineResult.finalStateHash) {
    fail('REPLAY_MISMATCH', 'replaying the baseline match did not reproduce its recorded final state hash');
  }
  const afterConfig = { ...baselineResult.config, dataHash: hashData(patched) };
  const after = run(afterConfig, patched, 'after');
  const winner = (o) => (o.status === 'win' ? o.winners[0] : o.status);
  return {
    kind: 'before_after',
    version: 1,
    matchId: baselineResult.matchId,
    seed: baselineResult.config.seed,
    players: baselineResult.config.players,
    heroes: before.heroes ?? null,
    selection: selection ?? null,
    patch: { baseDataHash: proposal.baseDataHash, replacements: proposal.replacements, rationale: proposal.rationale },
    before: side(baselineResult.config.dataHash, before),
    after: side(afterConfig.dataHash, after),
    delta: {
      winnerBefore: winner(before.outcome),
      winnerAfter: winner(after.outcome),
      winnerChanged: winner(before.outcome) !== winner(after.outcome),
      durationTicks: after.durationTicks - before.durationTicks,
    },
  };
});

/**
 * v0.1 runner results pin the hero seats inside GameData, so each seat variant has its own dataHash.
 * Given one base GameData, find which hashes in `results` it (or its seat-reversed copy) explains.
 * @returns {Map<string, object>} dataHash -> GameData
 */
export function resolveDataVariants(results, baseData, hashData) {
  const variants = new Map();
  const wanted = new Set(results.map((r) => r.config.dataHash));
  const candidates = [baseData];
  const seats = baseData?.gameRules?.seats;
  if (Array.isArray(seats) && seats.length === 2) {
    const reversed = structuredClone(baseData);
    reversed.gameRules.seats = [...seats].reverse();
    candidates.push(reversed);
  }
  for (const c of candidates) {
    const h = hashData(c);
    if (wanted.has(h) && !variants.has(h)) variants.set(h, c);
  }
  return variants;
}
