// Diagnosis of a flagged matchup "A vs B": is the winner too strong overall, the loser too weak overall, or only this
// pairing off? Both heroes are measured against every other hero (non-mirror), then classified and given ranked
// recommendations. Everything here is arithmetic on recorded results: nothing is guessed and nothing is applied; a
// recommendation is context for the patch adapter, and any patch still goes through validation and the holdout.
//
// Not available in the engine statistics yet: damage per move and hits through guard (CHANGE_REQUEST.md). The lever is
// therefore picked by use counts, hero-unique moves first (a shared move also changes the other heroes that own it, and
// the recommendation says so in `alsoAffects`). There is no global lever: scaling every hero's damage is not a way to
// change one hero's strength.
import { assertMatchResults } from './input-check.js';
import { heroMatchup, isCountable } from './group.js';
import { BAND_HIGH, BAND_LOW, MIN_GAMES_FOR_OUTLIER } from './analyzer.js';
import { HUMAN_PREFIX } from './extras.js';
import { isMirror } from './verdict.js';
import { fail, safely } from './errors.js';
import { round6, wilson95 } from './wilson.js';

export const CLASSIFICATIONS = ['overall_strong', 'overall_weak', 'counter_specific'];
const ATTACKS = ['melee', 'projectile'];
const MAX_LEVERS_PER_HERO = 3;
const STAT_BOUNDS = { health: [100, 3000], speed: [30, 400] }; // contract v0.1.2, also within 40% of the root value
// A weak hero is slow or fragile: speed first (it closes the gap), then health. A strong hero: health first.
const STAT_ORDER = { loser: ['speed', 'health'], winner: ['health', 'speed'] };
const STEP_PCT = 5;
const MIN_SIZE_PCT = 5;
const MAX_SIZE_PCT = 30;

const stat = (wins, games) => ({ rate: games ? round6(wins / games) : 0, ci95: wilson95(wins, games), games });
const roundTo = (x, step) => Math.round(x / step) * step;
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
const pts = (rate) => Math.round((rate - 0.5) * 1000) / 10; // percentage points above 50%, one decimal

/** The flagged matchup furthest from 50% (non-mirror, non-human rows), ties alphabetical; null if none. */
export function focusMatchupOf(report) {
  return report.rows.filter((r) => r.outlier && !r.dimension.startsWith(HUMAN_PREFIX) && !isMirror(r))
    .sort((a, b) => Math.abs(b.winRate - 0.5) - Math.abs(a.winRate - 0.5) || (a.dimension < b.dimension ? -1 : 1))[0]
    ?.dimension ?? null;
}

/** Canonical matchup strings (heroes sorted, as in report rows) a diagnosis of `matchup` has to run. */
export function diagnosisMatchups(matchup, heroIds) {
  const [a, b] = matchup.split(' vs ');
  const canonical = (x, y) => [x, y].sort().join(' vs ');
  const others = heroIds.filter((h) => h !== a && h !== b);
  return [...new Set([...others.map((o) => canonical(a, o)), ...others.map((o) => canonical(b, o))])].sort();
}

/** Per hero and per opponent: wins and games, counted from the results (draws are games, not wins). */
function tally(results) {
  const byHero = new Map(); // hero -> opponent -> { wins, games, uses: { actionId: uses } }
  for (const result of results.filter(isCountable)) {
    const m = heroMatchup(result);
    if (!m) continue;
    const asg = result.config.options.assignments;
    const [x, y] = result.config.players.map((p) => asg[p]);
    if (x === y) continue; // mirrors say nothing about hero strength
    for (const player of result.config.players) {
      const hero = asg[player];
      const opponent = player === result.config.players[0] ? y : x;
      const byOpponent = byHero.get(hero) ?? new Map();
      byHero.set(hero, byOpponent);
      const cell = byOpponent.get(opponent) ?? { wins: 0, games: 0, uses: {} };
      byOpponent.set(opponent, cell);
      cell.games += 1;
      if (result.outcome.status === 'win' && result.outcome.winners.includes(player)) cell.wins += 1;
      const stats = result.statistics.players.find((p) => p.playerId === player);
      for (const a of stats?.actions ?? []) cell.uses[a.actionId] = (cell.uses[a.actionId] ?? 0) + a.uses;
    }
  }
  return byHero;
}

const above = (s) => s.games >= MIN_GAMES_FOR_OUTLIER && s.ci95[0] > BAND_HIGH;
const below = (s) => s.games >= MIN_GAMES_FOR_OUTLIER && s.ci95[1] < BAND_LOW;

function heroEntry(hero, byOpponent, role) {
  const opponents = [...byOpponent.keys()].sort().map((opponent) => {
    const { wins, games } = byOpponent.get(opponent);
    return { opponent, ...stat(wins, games) };
  });
  const wins = [...byOpponent.values()].reduce((n, c) => n + c.wins, 0);
  const games = [...byOpponent.values()].reduce((n, c) => n + c.games, 0);
  const overall = stat(wins, games);
  const outside = role === 'winner' ? above : below;
  const worst = [...opponents].sort((p, q) => (role === 'winner' ? q.rate - p.rate : p.rate - q.rate) ||
    (p.opponent < q.opponent ? -1 : 1))[0];
  return { hero, overall, opponents, strength: { role, overallRate: overall.rate, marginPts: pts(overall.rate),
    opponentsOutsideBand: opponents.filter(outside).length, worstOpponent: worst?.opponent ?? null } };
}

/**
 * How far a hero stat can still move in `direction` (percent of its current value): the nearer of the absolute bound
 * and the 40% band around the root value. Zero when it cannot move that way any more.
 */
function statRoomPct(current, rootValue, stat, direction) {
  const [low, high] = STAT_BOUNDS[stat];
  const limit = direction === 'down' ? Math.max(low, Math.ceil((rootValue * 6) / 10))
    : Math.min(high, Math.floor((rootValue * 14) / 10));
  const room = direction === 'down' ? current - limit : limit - current;
  return room > 0 ? Math.floor((room * 100) / current) : 0;
}

/**
 * Levers of one hero, best first. Moves are shared between heroes (melee, projectile and guard each belong to several),
 * and changing a shared move changes every owner, so hero-only levers come first: the hero's unique attacks (most
 * used first), then its health and speed (contract v0.1.2; a weak hero: speed, then health; a strong one: health, then
 * speed), then other unique moves, and only then shared attacks (most used first), each marked with the other heroes it
 * would also change. A stat that has no room left in the wanted direction is not offered.
 */
function leversFor(data, hero, uses, role, rootData) {
  const ownIds = data.characters.find((c) => c.id === hero)?.moveIds ?? [];
  const ownersOf = (move) => data.characters.filter((c) => c.moveIds.includes(move.id)).map((c) => c.id).sort();
  const owned = data.moves.filter((m) => ownIds.includes(m.id)).map((move) => ({ move, owners: ownersOf(move) }));
  const attack = ({ move }) => ATTACKS.includes(move.archetype);
  const unique = ({ owners }) => owners.length === 1;
  const used = ({ move }) => uses[move.archetype] ?? 0;
  const byUse = (x, y) => used(y) - used(x) || (x.move.id < y.move.id ? -1 : 1);
  const byId = (x, y) => (x.move.id < y.move.id ? -1 : 1);
  const total = ATTACKS.reduce((n, action) => n + (uses[action] ?? 0), 0);
  const moveLever = (o) => ({ path: `/moves/${data.moves.indexOf(o.move)}/power`, move: o.move.id,
    action: o.move.archetype, attack: attack(o), share: attack(o) && total ? Math.round((used(o) / total) * 100) : null,
    alsoAffects: o.owners.filter((h) => h !== hero) });
  const index = data.characters.findIndex((c) => c.id === hero);
  const direction = role === 'winner' ? 'down' : 'up';
  const statLevers = STAT_ORDER[role].map((stat) => {
    const current = data.characters[index]?.[stat];
    const rootValue = rootData.characters?.[index]?.[stat];
    if (!Number.isInteger(current) || !Number.isInteger(rootValue)) return null;
    const roomPct = statRoomPct(current, rootValue, stat, direction);
    return roomPct < MIN_SIZE_PCT ? null : { path: `/characters/${index}/${stat}`, stat, current, roomPct,
      attack: false, share: null, alsoAffects: [] };
  }).filter(Boolean);
  return [...owned.filter((o) => attack(o) && unique(o)).sort(byUse).map(moveLever), ...statLevers,
    ...owned.filter((o) => !attack(o) && unique(o)).sort(byId).map(moveLever),
    ...owned.filter((o) => attack(o) && !unique(o)).sort(byUse).map(moveLever)];
}

function recommendation({ entry, role, lever, sizePct, scope, outside, total, why }) {
  return { hero: entry.hero, role, path: lever.path, direction: role === 'winner' ? 'down' : 'up', sizePct,
    why, expected: `brings ${outside} of ${total} matchups toward the band`, scope, alsoAffects: lever.alsoAffects };
}

function leverRecommendations(entry, role, ctx, uses, sizePct, scope, outside, total) {
  const verb = role === 'winner' ? 'lower' : 'raise';
  const where = scope === 'interaction' ? 'in this matchup' : 'across its matchups';
  const who = `${entry.hero} is ${role === 'winner' ? 'too strong' : 'too weak'} (${entry.strength.marginPts} points `
    + 'from 50% overall)';
  return leversFor(ctx.data, entry.hero, uses, role, ctx.rootData).slice(0, MAX_LEVERS_PER_HERO).map((lever) => {
    if (lever.stat) {
      const size = Math.min(sizePct, Math.floor(lever.roomPct / STEP_PCT) * STEP_PCT);
      return recommendation({ entry, role, lever, sizePct: size, scope, outside, total,
        why: `${who}: ${verb} ${lever.stat}, a stat that belongs to ${entry.hero} alone (now ${lever.current}; it may `
          + `still move about ${lever.roomPct}% this way within the 40% limit from the original value).` });
    }
    const share = lever.share === null ? '' : ` (${lever.share}% of its attack uses ${where})`;
    const kind = lever.attack ? 'attack' : 'move';
    const ownership = lever.alsoAffects.length === 0 ? `its own ${kind}, no other hero has it`
      : `a ${kind} shared with ${lever.alsoAffects.join(', ')}: this also changes them, so it ranks below the `
        + 'hero\'s own moves';
    return recommendation({ entry, role, lever, sizePct, scope, outside, total,
      why: `${who}: ${verb} ${lever.move}, ${ownership}${share}. Damage per move is not recorded yet, so use counts `
        + 'stand in for the highest-damage move.' });
  });
}

/**
 * results: MatchResults of the focus matchup and of both focus heroes against the other heroes (one dataHash).
 * options: { matchup: 'a vs b', data: GameData (moves, characters, tuning), rootData: the original game data that hero
 * stats stay within 40% of (default: `data`) }.
 * @returns {{ok: true, value: {focusHero, matchup, heroes, classification, recommendations}} | error result}
 */
export const buildDiagnosis = safely((results, options = {}) => {
  assertMatchResults(results);
  const { matchup, data } = options;
  const ctx = { data, rootData: options.rootData ?? data };
  const [a, b, ...rest] = String(matchup ?? '').split(' vs ');
  if (!a || !b || a === b || rest.length) fail('INVALID_INPUT', 'matchup must be "a vs b" with two different heroes');
  if (!Array.isArray(data?.moves) || !Array.isArray(data?.characters)) {
    fail('INVALID_INPUT', 'data needs moves and characters');
  }
  const byHero = tally(results);
  const focus = byHero.get(a)?.get(b);
  if (!focus || focus.games === 0) fail('NO_RESULTS', `no games for ${matchup}`);
  const winner = focus.wins / focus.games >= 0.5 ? a : b;
  const loser = winner === a ? b : a;
  const heroes = [heroEntry(winner, byHero.get(winner), 'winner'), heroEntry(loser, byHero.get(loser), 'loser')];
  const [W, L] = heroes;

  const others = (entry, other) => entry.opponents.filter((o) => o.opponent !== other);
  const m = others(W, loser).length; // opponents besides the focus partner
  const strongCount = others(W, loser).filter(above).length;
  const weakCount = others(L, winner).filter(below).length;
  const most = (n) => m > 0 && n * 2 > m;
  let classification = 'counter_specific';
  if (most(strongCount) && most(weakCount)) {
    const winnerGap = Math.abs(W.strength.marginPts);
    classification = winnerGap >= Math.abs(L.strength.marginPts) ? 'overall_strong' : 'overall_weak';
  } else if (most(strongCount)) classification = 'overall_strong';
  else if (most(weakCount)) classification = 'overall_weak';

  const usesOf = (hero, onlyOpponent) => {
    const uses = {};
    for (const [opponent, cell] of byHero.get(hero)) {
      if (onlyOpponent && opponent !== onlyOpponent) continue;
      for (const [action, n] of Object.entries(cell.uses)) uses[action] = (uses[action] ?? 0) + n;
    }
    return uses;
  };
  const sizeFor = (marginPts, factor) => clamp(roundTo(Math.abs(marginPts) * factor, STEP_PCT), MIN_SIZE_PCT,
    MAX_SIZE_PCT);
  const overall = (entry, role) => {
    const total = entry.opponents.length;
    const out = entry.strength.opponentsOutsideBand;
    const size = sizeFor(entry.strength.marginPts, 0.8);
    return leverRecommendations(entry, role, ctx, usesOf(entry.hero), size, 'overall', out, total);
  };
  const interaction = (entry, role) => {
    const size = sizeFor(pts(focus.wins / focus.games), 0.5);
    const partner = entry === W ? loser : winner;
    return leverRecommendations(entry, role, ctx, usesOf(entry.hero, partner), size, 'interaction', 1, 1);
  };
  const recommendations = classification === 'overall_strong' ? [...overall(W, 'winner'), ...overall(L, 'loser')]
    : classification === 'overall_weak' ? [...overall(L, 'loser'), ...overall(W, 'winner')]
      : [...interaction(W, 'winner'), ...interaction(L, 'loser')];
  return { focusHero: recommendations[0]?.hero ?? null, matchup: [a, b].sort().join(' vs '), heroes,
    classification, recommendations };
});
