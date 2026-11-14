// Diagnosis of a flagged matchup "A vs B": is the winner too strong overall, the loser too weak overall, or only this
// pairing off? Both heroes are measured against every other hero (non-mirror), then classified and given ranked
// recommendations. Everything here is arithmetic on recorded results: nothing is guessed and nothing is applied; a
// recommendation is context for the patch adapter, and any patch still goes through validation and the holdout.
//
// Not available in the engine statistics yet: damage per move and hits through guard (CHANGE_REQUEST.md). The lever is
// therefore the hero's most-used attack (melee or projectile) and `why` says so.
import { assertMatchResults } from './input-check.js';
import { heroMatchup, isCountable } from './group.js';
import { BAND_HIGH, BAND_LOW, MIN_GAMES_FOR_OUTLIER } from './analyzer.js';
import { HUMAN_PREFIX } from './extras.js';
import { isMirror } from './verdict.js';
import { fail, safely } from './errors.js';
import { round6, wilson95 } from './wilson.js';

export const CLASSIFICATIONS = ['overall_strong', 'overall_weak', 'counter_specific'];
const ATTACKS = ['melee', 'projectile'];
const GLOBAL_PATH = '/tuning/damageScalePermille';
const NEARLY_ALL = 0.75; // "off against nearly everyone": this share of opponents is outside the band
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

/** The hero's most-used attack (melee or projectile) in `uses`, and the move that carries it. */
function leverFor(data, hero, uses) {
  const action = [...ATTACKS].sort((x, y) => (uses[y] ?? 0) - (uses[x] ?? 0) || (x < y ? -1 : 1))[0];
  const owned = data.moves.filter((m) => data.characters.find((c) => c.id === hero)?.moveIds.includes(m.id));
  const move = owned.find((m) => m.archetype === action) ?? owned.find((m) => ATTACKS.includes(m.archetype));
  if (!move) return null;
  const used = uses[action] ?? 0;
  const total = ATTACKS.reduce((n, a) => n + (uses[a] ?? 0), 0);
  return { path: `/moves/${data.moves.indexOf(move)}/power`, move: move.id, action,
    share: total ? Math.round((used / total) * 100) : null };
}

function recommendation({ entry, role, lever, sizePct, scope, outside, total, why }) {
  return { hero: entry.hero, role, path: lever.path, direction: role === 'winner' ? 'down' : 'up', sizePct,
    why, expected: `brings ${outside} of ${total} matchups toward the band`, scope };
}

function attackRecommendation(entry, role, data, uses, sizePct, scope, outside, total) {
  const lever = leverFor(data, entry.hero, uses);
  if (!lever) return null;
  const verb = role === 'winner' ? 'lower' : 'raise';
  const where = scope === 'interaction' ? 'in this matchup' : 'across its matchups';
  const share = lever.share === null ? '' : ` (${lever.share}% of its attack uses ${where})`;
  return recommendation({ entry, role, lever, sizePct, scope, outside, total,
    why: `${entry.hero} is ${role === 'winner' ? 'too strong' : 'too weak'} (${entry.strength.marginPts} points from `
      + `50% overall): ${verb} ${lever.move}, its most-used attack${share}. Damage per move is not recorded yet, `
      + 'so the most-used attack stands in for the highest-damage move.' });
}

function globalRecommendation(entry, role, sizePct, total) {
  const lever = { path: GLOBAL_PATH };
  return recommendation({ entry, role, lever, sizePct, scope: 'global', outside: entry.strength.opponentsOutsideBand,
    total, why: `${entry.hero} is off against nearly every opponent. This lever is global: it scales the damage of `
      + 'every hero, so use it only if no single move explains the gap.' });
}

/**
 * results: MatchResults of the focus matchup and of both focus heroes against the other heroes (one dataHash).
 * options: { matchup: 'a vs b', data: GameData (moves, characters, tuning) }.
 * @returns {{ok: true, value: {focusHero, matchup, heroes, classification, recommendations}} | error result}
 */
export const buildDiagnosis = safely((results, options = {}) => {
  assertMatchResults(results);
  const { matchup, data } = options;
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
    const list = [attackRecommendation(entry, role, data, usesOf(entry.hero), size, 'overall', out, total)];
    if (out >= Math.ceil(NEARLY_ALL * total)) list.push(globalRecommendation(entry, role, size, total));
    return list.filter(Boolean);
  };
  const interaction = (entry, role) => {
    const size = sizeFor(pts(focus.wins / focus.games), 0.5);
    const partner = entry === W ? loser : winner;
    return [attackRecommendation(entry, role, data, usesOf(entry.hero, partner), size, 'interaction', 1, 1)]
      .filter(Boolean);
  };
  const recommendations = classification === 'overall_strong' ? [...overall(W, 'winner'), ...overall(L, 'loser')]
    : classification === 'overall_weak' ? [...overall(L, 'loser'), ...overall(W, 'winner')]
      : [...interaction(W, 'winner'), ...interaction(L, 'loser')];
  return { focusHero: recommendations[0]?.hero ?? null, matchup: [a, b].sort().join(' vs '), heroes,
    classification, recommendations };
});
