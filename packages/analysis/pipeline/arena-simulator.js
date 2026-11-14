// Adapter from the Hero Arena engine to the replay simulator interface. Mirrors services/runner/match.js
// (same loop, same bot policy and per-seat variant), so a replay reproduces the recorded hash.
// Loaded lazily so the analysis package has no import-time dependency on the engine.
import { errorResult } from '../src/errors.js';

export function createArenaSimulator({ arena, chooseAction, hash, compareIds }) {
  const simulate = ({ config, data }) => {
    let state = arena.initial(config, data);
    const hpOf = (s) => Object.fromEntries(s.payload.entities.map((e) => [e.id, e.hp]));
    const heroes = Object.fromEntries(state.payload.entities.map((e) => [e.id, e.hero]));
    const maxHp = Object.fromEntries(state.payload.entities.map((e) => [e.id, data.characters.find((c) => c.id === e.hero).health]));
    const timeline = [{ tick: 0, hp: hpOf(state) }];
    let last = JSON.stringify(timeline[0].hp);
    while (arena.outcome(state).status === 'running') {
      const actions = config.players
        .map((id, i) => chooseAction(arena.observe(state, id), state.tick, i))
        .filter(Boolean)
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
    return { outcome: arena.outcome(state), finalStateHash: arena.hash(state), durationTicks: state.tick, heroes, maxHp, timeline };
  };
  return { simulate, hashData: hash };
}

/** Result-style loader: { ok: true, value: simulator } or an ENGINE_UNAVAILABLE error result. */
export async function loadArenaSimulator() {
  try {
    const arena = await import('../../games/action/index.js');
    const bot = await import('../../games/action/bot.js');
    const contracts = await import('../../contracts/index.js');
    return { ok: true, value: { ...createArenaSimulator({ arena, chooseAction: bot.chooseAction, hash: contracts.hash, compareIds: contracts.compareIds }), baseData: arena.data } };
  } catch {
    return errorResult('ENGINE_UNAVAILABLE', 'could not load the Hero Arena engine from packages/games/action');
  }
}
