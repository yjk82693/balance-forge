import * as arena from '../../packages/games/action/index.ts';
import * as cards from '../../packages/games/cards/index.ts';
import { chooseActions, deriveBotSeed, botPolicyVersion } from '../../packages/games/action/bot.ts';
import { hash, validate, validateOutcome, compareIds } from '../../packages/contracts/index.ts';
import { emptyStatistics } from '../../packages/sim/index.ts';
import * as cardBot from '../../packages/games/cards/bot.ts';
import { learnedBot } from './learn/load.ts';
import type { GameData, MatchConfig } from '../../packages/contracts/types.ts';

/** One match to play: its config, the game data it runs on and (optionally) which bot policy plays it. */
export type MatchJob = { matchId: string; config: MatchConfig; data: GameData; botPolicy?: string };
export type JobOptions = { seeds?: number[]; heroes?: string[]; gameId?: string; data?: GameData; botPolicy?: string };
export { botPolicyVersion };
// The scripted policy's version per game: results are tagged with the bot that produced them.
export const scriptedVersionOf = gameId => (gameId === 'hero_cards' ? cardBot.botPolicyVersion : botPolicyVersion);
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
// The runner's Hero Cards player: the seeded cards bot, seat index = position in config.players.
function turnAction(game, state, config) {
  const active = state.payload.activePlayer;
  return cardBot.chooseAction(game.observe(state, active), state.tick,
    cardBot.deriveBotSeed(config.seed, config.players.indexOf(active)));
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
      const actions = config.mode === 'turn' ? [turnAction(game, state, config)] : config.players.flatMap((id,
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
}: JobOptions = {}): MatchJob[] {
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
}: Omit<JobOptions, 'heroes'> = {}): MatchJob[] {
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
