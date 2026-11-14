import * as arena from '../../packages/games/action/index.js';
import * as cards from '../../packages/games/cards/index.js';
import { chooseActions, deriveBotSeed, botPolicyVersion } from '../../packages/games/action/bot.js';
import { hash, validate, validateOutcome, compareIds } from '../../packages/contracts/index.js';
import { emptyStatistics } from '../../packages/sim/index.js';
import { learnedBot } from './learn/load.js';
export { botPolicyVersion };
export const games = {
  hero_arena: arena,
  hero_cards: cards
};
export function cardAction(game, state, seq) {
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
function getGame(gameId) {
  if (!Object.hasOwn(games, gameId)) throw Error('INVALID_SCHEMA');
  return games[gameId];
}
// Which bot plays a job: 'scripted' (default, scripted-0.2.1) or 'learned' (trained parameters, see learn/).
export const botPolicies = ['scripted', 'learned'];
function botFor(job) {
  if (job.botPolicy === undefined || job.botPolicy === 'scripted') return { chooseActions, deriveBotSeed };
  if (job.botPolicy !== 'learned') throw Error('INVALID_SCHEMA');
  const bot = learnedBot();
  if (!bot) throw Error('LEARNED_UNAVAILABLE');
  return bot;
}
export function executeMatch(job, {
  captureReplay = false
} = {}) {
  if (!job || typeof job !== 'object') throw Error('INVALID_SCHEMA');
  validate('MatchConfig', job.config);
  const bot = botFor(job);
  const {
      matchId,
      config,
      data
    } = job,
    game = Object.hasOwn(games, config.gameId) ? games[config.gameId] : null;
  let state;
  const frames = [];
  try {
    if (!game) throw Error('INVALID_SCHEMA');
    state = game.initial(config, data);
    while (game.outcome(state).status === 'running') {
      const actions = config.mode === 'turn' ? [cardAction(game, state, state.tick)] : config.players.flatMap((id,
        i) => bot.chooseActions(game.observe(state, id), state.tick * 2,
          bot.deriveBotSeed(config.seed, i))).sort((a, b) => compareIds(a.playerId, b.playerId));
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
  }, (_, index) => index + 1),
  heroes,
  gameId = 'hero_arena',
  data,
  botPolicy
} = {}) {
  const game = getGame(gameId);
  data ??= game.data;
  validate('GameData', data);
  checkBotPolicy(gameId, botPolicy);
  const selected = heroes === undefined ? gameId === 'hero_arena' ? ['bari', 'real_armor'] : ['standard',
    'standard'] : heroes;
  if (!Array.isArray(selected) || selected.length !== 2 || !Array.isArray(seeds) || !seeds.length || seeds.some(
    seed => !Number.isInteger(seed) || seed < 1 || seed > 4294967295)) throw Error('INVALID_SCHEMA');
  const roster = gameId === 'hero_arena' ? data.characters : data.gameRules.decks;
  if (!Array.isArray(roster) || !roster.length || selected.some(id => !roster.some(item =>
    item.id === id))) throw Error('INVALID_SCHEMA');
  const jobs = [];
  for (const seed of seeds) for (let swap = 0; swap < 2; swap++) {
    const players = ['p1', 'p2'],
      order = swap ? [...selected].reverse() : selected;
    const config = game.makeConfig(data, seed, players);
    config.options = {
      assignments: Object.fromEntries(players.map((id, index) => [id, order[index]]))
    };
    jobs.push({
      matchId: `m-${jobs.length + 1}`,
      config,
      data,
      ...(botPolicy === undefined ? {} : { botPolicy })
    });
  }
  return jobs;
}
// 'learned' needs trained parameters and only exists for Hero Arena; asking for it without them is an explicit error.
function checkBotPolicy(gameId, botPolicy) {
  if (botPolicy === undefined || botPolicy === 'scripted') return;
  if (botPolicy !== 'learned' || gameId !== 'hero_arena') throw Error('INVALID_SCHEMA');
  if (!learnedBot()) throw Error('LEARNED_UNAVAILABLE');
}
export function rosterJobs({
  seeds = Array.from({
    length: 10
  }, (_, index) => index + 1),
  gameId = 'hero_arena',
  data,
  botPolicy
} = {}) {
  const game = getGame(gameId);
  data ??= game.data;
  validate('GameData', data);
  checkBotPolicy(gameId, botPolicy);
  const roster = gameId === 'hero_arena' ? data.characters : data.gameRules.decks;
  if (!Array.isArray(roster) || !roster.length) throw Error('INVALID_SCHEMA');
  const jobs = [];
  for (let left = 0; left < roster.length; left++) for (let right = left; right < roster.length; right++) {
    const pair = pairedJobs({
      seeds,
      heroes: [roster[left].id, roster[right].id],
      gameId,
      data,
      botPolicy
    });
    for (const job of pair) {
      job.matchId = `m-${jobs.length + 1}`;
      jobs.push(job);
    }
  }
  return jobs;
}
