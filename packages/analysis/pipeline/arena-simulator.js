// Adapter from the Hero Arena engine to the replay simulator interface. Mirrors services/runner/match.js
// (same loop, same bot policy and per-seat variant), so a replay reproduces the recorded hash.
// Loaded lazily so the analysis package has no import-time dependency on the engine.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorResult } from '../src/errors.js';

// The engine's bot is `chooseActions(view, seq, variant)` returning an array, called with seq = tick * 2 (arena-0.1.1).
// The older single-action `chooseAction(view, tick, variant)` is still accepted.
export function createArenaSimulator({ arena, chooseActions, chooseAction, hash, compareIds }) {
  const needed = { 'arena.initial': arena?.initial, 'arena.observe': arena?.observe, 'arena.step': arena?.step,
    'arena.outcome': arena?.outcome, 'arena.hash': arena?.hash, hash, compareIds };
  const missing = Object.keys(needed).filter((k) => typeof needed[k] !== 'function');
  if (typeof chooseActions !== 'function' && typeof chooseAction !== 'function') missing.push('chooseActions');
  if (missing.length) throw new TypeError(`Hero Arena engine export missing: ${missing.join(', ')}`);
  const decide = (view, tick, seat) => (chooseActions ? chooseActions(view, tick * 2, seat)
    : [chooseAction(view, tick, seat)].filter(Boolean));
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
        .flatMap((id, i) => decide(arena.observe(state, id), state.tick, i))
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
    return { ok: true, value: { ...createArenaSimulator({ arena, chooseActions: bot.chooseActions,
      chooseAction: bot.chooseAction, hash: contracts.hash, compareIds: contracts.compareIds }),
    baseData: arena.data } };
  } catch (error) {
    // Say exactly what failed (a missing file or export), never a bare "unavailable".
    return errorResult('ENGINE_UNAVAILABLE',
      `could not load the Hero Arena engine from packages/games/action: ${error?.message ?? 'unknown error'}`);
  }
}
