// Adapter from the Hero Arena engine to the replay simulator interface. Mirrors services/runner/match.js
// (same loop, same bot policy and per-seat variant), so a replay reproduces the recorded hash.
// Loaded lazily so the analysis package has no import-time dependency on the engine.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorResult } from '../src/errors.js';

// ======================================================================================================
// PLUG-IN POINT (the only place to edit for a new bot policy): bot seed derivation per policy version.
// The runner calls `chooseActions(view, seq, variant)`; `seq` and `variant` come from here. Each entry gets
// ({ tick, seat, config }, bot): tick = state.tick before the step, seat = index in config.players, bot = the
// engine's bot module (so the engine's own exported functions are used, never a copy).
// scripted-0.1.1: seq = tick * 2, variant = seat.
// scripted-0.2.1: seq = tick * 2, variant = deriveBotSeed(config.seed, seat), as services/runner/match.js does.
// loadArenaSimulator refuses a bot whose policy version has no entry, instead of replaying with a wrong
// derivation and failing the hash check later.
// ======================================================================================================
export const BOT_SEED_DERIVATIONS = {
  'scripted-0.1.1': ({ tick, seat }) => ({ seq: tick * 2, variant: seat }),
  'scripted-0.2.1': ({ tick, seat, config }, bot) => ({ seq: tick * 2, variant: bot.deriveBotSeed(config.seed, seat) }),
};

// The engine's bot is `chooseActions(view, seq, variant)` returning an array (arena-0.1.1 and later).
// The older single-action `chooseAction(view, tick, variant)` is still accepted.
export function createArenaSimulator({ arena, chooseActions, chooseAction, hash, compareIds,
  botSeed = BOT_SEED_DERIVATIONS['scripted-0.1.1'] }) {
  const needed = { 'arena.initial': arena?.initial, 'arena.observe': arena?.observe, 'arena.step': arena?.step,
    'arena.outcome': arena?.outcome, 'arena.hash': arena?.hash, hash, compareIds };
  const missing = Object.keys(needed).filter((k) => typeof needed[k] !== 'function');
  if (typeof chooseActions !== 'function' && typeof chooseAction !== 'function') missing.push('chooseActions');
  if (missing.length) throw new TypeError(`Hero Arena engine export missing: ${missing.join(', ')}`);
  if (typeof botSeed !== 'function') throw new TypeError('botSeed must be a function');
  const decide = (view, tick, seat, config) => {
    const { seq, variant } = botSeed({ tick, seat, config });
    return chooseActions ? chooseActions(view, seq, variant) : [chooseAction(view, tick, variant)].filter(Boolean);
  };
  const simulate = ({ config, data }) => {
    let state = arena.initial(config, data);
    const hpOf = (s) => Object.fromEntries(s.payload.entities.map((e) => [e.id, e.hp]));
    const heroes = Object.fromEntries(state.payload.entities.map((e) => [e.id, e.hero]));
    const maxHp = Object.fromEntries(state.payload.entities.map((e) => [e.id,
      data.characters.find((c) => c.id === e.hero).health]));
    const timeline = [{ tick: 0, hp: hpOf(state) }];
    let last = JSON.stringify(timeline[0].hp);
    while (arena.outcome(state).status === 'running') {
      const actions = config.players
        .flatMap((id, i) => decide(arena.observe(state, id), state.tick, i, config))
        .sort((a, b) => compareIds(a.playerId, b.playerId));
      state = arena.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
      const hp = hpOf(state);
      const key = JSON.stringify(hp);
      const done = arena.outcome(state).status !== 'running';
      if (key !== last || done) {
        timeline.push({ tick: state.tick, hp });
        last = key;
      }
    }
    return { outcome: arena.outcome(state), finalStateHash: arena.hash(state), durationTicks: state.tick, heroes,
      maxHp, timeline };
  };
  return { simulate, hashData: hash };
}

/** Result-style loader: { ok: true, value: simulator } or an ENGINE_UNAVAILABLE error result. */
export async function loadArenaSimulator(engineRoot) {
  const load = (rel) => (engineRoot ? import(pathToFileURL(join(resolve(engineRoot), rel)).href)
    : import(new URL(`../../../${rel}`, import.meta.url).href));
  try {
    const arena = await load('packages/games/action/index.js');
    const bot = await load('packages/games/action/bot.js');
    const contracts = await load('packages/contracts/index.js');
    const derive = BOT_SEED_DERIVATIONS[bot.botPolicyVersion];
    if (!derive || (bot.botPolicyVersion !== 'scripted-0.1.1' && typeof bot.deriveBotSeed !== 'function')) {
      return errorResult('ENGINE_UNAVAILABLE', `bot policy ${bot.botPolicyVersion} has no seed derivation; `
        + 'add it to BOT_SEED_DERIVATIONS in pipeline/arena-simulator.js');
    }
    return { ok: true, value: { ...createArenaSimulator({ arena, chooseActions: bot.chooseActions,
      chooseAction: bot.chooseAction, hash: contracts.hash, compareIds: contracts.compareIds,
      botSeed: (args) => derive(args, bot) }),
    baseData: arena.data, botPolicyVersion: bot.botPolicyVersion } };
  } catch (error) {
    // Say exactly what failed (a missing file or export), never a bare "unavailable".
    return errorResult('ENGINE_UNAVAILABLE',
      `could not load the Hero Arena engine from packages/games/action: ${error?.message ?? 'unknown error'}`);
  }
}
