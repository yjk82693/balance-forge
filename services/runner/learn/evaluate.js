// Plays matches for the trainer and the eval tool, in process: the learned or scripted bots decide from observations
// only, the simulation advances through its own step function, and the result is a score per seat. No wall clock, no
// simulation-state access by the bots, no simulation RNG draws by the trainer.
import * as arena from '../../../packages/games/action/index.js';
import { compareIds } from '../../../packages/contracts/index.js';
import { makeLearnedBot } from '../../../packages/games/action/bot-learned.js';
import * as scripted from '../../../packages/games/action/bot.js';
import { wilson95, round6 } from './stats.js';

/** Training seeds sit far from the evaluation seeds (1..N) and from the held-out seeds: they never overlap. */
export const TRAIN_SEED_BASE = 5_000_001;
export const HELD_OUT_SEED_BASE = 7_000_001;
export const MAX_TICKS = 900;

export const seedRange = (from, count) => Array.from({ length: count }, (_, i) => from + i);

export function assertDisjoint(a, b, what = 'seed sets') {
  const taken = new Set(a);
  if (b.some(seed => taken.has(seed))) throw Error(`INVALID_SCHEMA: ${what} overlap`);
}

/** The scripted 0.2.1 policy as a bot object with the same shape as a learned one. */
export const scriptedBot = { chooseActions: scripted.chooseActions, deriveBotSeed: scripted.deriveBotSeed,
  botPolicyVersion: scripted.botPolicyVersion };

/** One match. `bots` maps a seat to a bot object ({ chooseActions, deriveBotSeed }). Returns who won and how long. */
export function playMatch({ heroes, bots, seed, maxTicks = MAX_TICKS }) {
  const config = arena.makeConfig(arena.data, seed, ['p1', 'p2'], maxTicks, heroes);
  config.options = { assignments: heroes };
  let state = arena.initial(config, arena.data);
  while (arena.outcome(state).status === 'running') {
    const actions = config.players.flatMap((id, seat) => bots[id].chooseActions(arena.observe(state, id),
      state.tick * 2, bots[id].deriveBotSeed(seed, seat))).sort((a, b) => compareIds(a.playerId, b.playerId));
    state = arena.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, arena.data).state;
  }
  const outcome = arena.outcome(state);
  return { winner: outcome.status === 'win' ? outcome.winners[0] : null, ticks: state.tick, hp:
    Object.fromEntries(state.payload.entities.map(e => [e.id, e.hp])) };
}

/** 1 for a win, 0.5 for a draw (including the tick limit), 0 for a loss. */
export const scoreFor = (result, seat) => (result.winner === null ? 0.5 : result.winner === seat ? 1 : 0);

/**
 * Fitness of one parameter vector for `hero`: its mean score against each opponent hero (the others use their current
 * parameters from `population`, or the scripted policy where there are none), both seat orders, on `seeds`.
 */
export function evaluateVector({ hero, params, population = {}, opponents, seeds, maxTicks = MAX_TICKS }) {
  const learnedBot = makeLearnedBot({ ...population, [hero]: params });
  let total = 0;
  let games = 0;
  for (const opponent of opponents) {
    for (const seed of seeds) {
      for (const swap of [false, true]) {
        const heroes = swap ? { p1: opponent, p2: hero } : { p1: hero, p2: opponent };
        const seat = swap ? 'p2' : 'p1';
        total += scoreFor(playMatch({ heroes, bots: { p1: learnedBot, p2: learnedBot }, seed, maxTicks }), seat);
        games += 1;
      }
    }
  }
  return games ? total / games : 0;
}

/**
 * A matchup measured with named bot sets: `botFor(hero)` returns the bot object a hero uses. First hero's win rate
 * with a Wilson interval over `seeds` x both seat orders (a draw is a game, not a win).
 */
export function measureMatchup({ heroes: [a, b], botFor, seeds, maxTicks = MAX_TICKS }) {
  let wins = 0;
  let games = 0;
  let ticks = 0;
  for (const seed of seeds) {
    for (const swap of [false, true]) {
      const seats = swap ? { p1: b, p2: a } : { p1: a, p2: b };
      const first = swap ? 'p2' : 'p1';
      const bots = { p1: botFor(seats.p1), p2: botFor(seats.p2) };
      const result = playMatch({ heroes: seats, bots, seed, maxTicks });
      if (result.winner === first) wins += 1;
      games += 1;
      ticks += result.ticks;
    }
  }
  return { games, wins, winRate: round6(wins / games), ci95: wilson95(wins, games), meanTicks: round6(ticks / games) };
}
