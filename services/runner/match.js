import * as arena from '../../packages/games/action/index.js';
import * as cards from '../../packages/games/cards/index.js';
import { chooseActions, botPolicyVersion } from '../../packages/games/action/bot.js';
import { hash, validate, validateOutcome, compareIds } from '../../packages/contracts/index.js';
import { emptyStatistics } from '../../packages/sim/index.js';
export { botPolicyVersion };
export const games = {
  hero_arena: arena,
  hero_cards: cards
};
function cardAction(game, state, seq) {
  const view = game.observe(state, state.payload.activePlayer),
    e = view.payload.entities.find(e => e.id === view.viewerId);
  const index = view.payload.hand.findIndex(c => c.cost <= e.energy && (c.kind !== 'summon' || e.units.length < 2));
  return {
    playerId: view.viewerId,
    seq,
    tick: state.tick + 1,
    turnId: state.turnId,
    actionId: index < 0 ? 'end_turn' : 'play',
    params: index < 0 ? {} : {
      handIndex: index,
      ...(view.payload.hand[index].kind === 'summon' ? {
        slot: e.units.length
      } : {})
    }
  };
}
export function executeMatch(job, {
  captureReplay = false
} = {}) {
  const {
      matchId,
      config,
      data
    } = job,
    game = games[config.gameId];
  let state;
  const frames = [];
  try {
    if (!game) throw Error('INVALID_SCHEMA');
    state = game.initial(config, data);
    while (game.outcome(state).status === 'running') {
      const actions = config.mode === 'turn' ? [cardAction(game, state, state.tick)] : config.players.flatMap((id,
        i) => chooseActions(game.observe(state, id), state.tick * 2, i)).sort((a, b) => compareIds(a.playerId,
        b.playerId));
      const frame = {
        tick: state.tick + 1,
        actions,
        systemInputs: []
      };
      state = game.step(state, frame, data).state;
      if (captureReplay) frames.push(frame);
    }
    const result = {
      matchId,
      config,
      outcome: game.outcome(state),
      statistics: game.statistics(state),
      finalStateHash: game.hash(state),
      valid: true,
      errorCode: ''
    };
    validate('MatchResult', result);
    validateOutcome(result.outcome, config.players);
    return {
      result,
      ...(captureReplay ? {
        replay: {
          matchId,
          seed: config.seed,
          config,
          frames,
          finalStateHash: result.finalStateHash
        }
      } : {})
    };
  } catch (error) {
    const known = ['INVALID_SCHEMA', 'ILLEGAL_ACTION', 'LATE_INPUT', 'STALE_TURN', 'VERSION_MISMATCH', 'HASH_MISMATCH'];
    const result = {
      matchId,
      config,
      outcome: {
        status: 'running',
        winners: [],
        reason: 'invalid_match'
      },
      statistics: emptyStatistics(config.players, game?.describe().actions.filter(a => a.actionId !== 'move').map(a =>
        a.actionId) ?? []),
      finalStateHash: hash(state ?? {}),
      valid: false,
      errorCode: known.includes(error.message) ? error.message : 'INVALID_SCHEMA'
    };
    return {
      result,
      ...(captureReplay ? {
        replay: {
          matchId,
          seed: config.seed,
          config,
          frames,
          finalStateHash: result.finalStateHash
        }
      } : {})
    };
  }
}
export const runMatch = job => executeMatch(job).result;
export function pairedJobs({
  seeds = Array.from({
    length: 100
  }, (_, i) => i + 1),
  heroes = ['bari', 'real_armor'],
  gameId = 'hero_arena',
  data = games[gameId]?.data
} = {}) {
  const game = games[gameId];
  if (!game || heroes.length !== 2 || seeds.length === 0 || seeds.some(s => !Number.isInteger(s) || s < 1 ||
    s > 4294967295)) throw Error('INVALID_SCHEMA');
  const jobs = [];
  for (const seed of seeds) for (let swap = 0; swap < 2; swap++) {
    const players = ['p1', 'p2'],
      order = swap ? [...heroes].reverse() : heroes;
    const config = game.makeConfig(data, seed, players);
    config.options = {
      assignments: Object.fromEntries(players.map((id, i) => [id, gameId === 'hero_arena' ? order[
        i] : data.gameRules.decks.some(d => d.id === order[i]) ? order[i] : 'standard']))
    };
    jobs.push({
      matchId: `m-${jobs.length + 1}`,
      config,
      data
    });
  }
  return jobs;
}
export function rosterJobs({
  seeds = Array.from({
    length: 10
  }, (_, i) => i + 1),
  gameId = 'hero_arena',
  data = games[gameId]?.data
} = {}) {
  const roster = gameId === 'hero_arena' ? data.characters.map(c => c.id) : data.gameRules.decks.map(d => d.id);
  const jobs = [];
  for (let i = 0; i < roster.length; i++) for (let j = i; j < roster.length; j++) {
    const pair = pairedJobs({
      seeds,
      heroes: [roster[i], roster[j]],
      gameId,
      data
    });
    for (const job of pair) {
      job.matchId = `m-${jobs.length + 1}`;
      jobs.push(job);
    }
  }
  return jobs;
}
