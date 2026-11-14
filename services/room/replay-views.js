import { hash } from '../../packages/contracts/index.js';
import { replayOnData } from '../../packages/sim/index.js';
import { games } from '../runner/match.js';

export const MAX_REPLAY_VIEWS = 601;
export const MAX_REPLAY_BYTES = 1048576;

export function replayViews(storage, matchId, { dataHash, every = 6 } = {}) {
  if (!Number.isInteger(every) || every < 1 || every > 1800) throw Error('INVALID_SCHEMA');
  const recording = storage.getReplay(matchId);
  if (!recording) return null;
  const { config, frames } = recording;
  if (Math.ceil(frames.length / every) + 1 > MAX_REPLAY_VIEWS) throw Error('RATE_LIMITED');
  const { data, dataHash: selectedHash } = storage.get(config.gameId, dataHash ?? config.dataHash);
  const game = games[config.gameId], views = [];
  let bytes = 0, pendingEvents = [];
  const state = replayOnData(game.adapter, recording, data, { onStep: ({ state, events }) => {
    pendingEvents.push(...events.filter(event => event.audience.length === 0));
    if (state.tick % every !== 0 && state.tick !== frames.length) return;
    const observation = game.observe(state, 'display');
    const view = { tick: state.tick, observation, events: pendingEvents, viewHash: hash(observation) };
    bytes += Buffer.byteLength(JSON.stringify(view));
    if (bytes > MAX_REPLAY_BYTES - 4096) throw Error('RATE_LIMITED');
    views.push(view); pendingEvents = [];
  } });
  if (!dataHash && hash(state) !== recording.finalStateHash) throw Error('HASH_MISMATCH');
  return { matchId, gameId: config.gameId, seed: config.seed, sourceDataHash: config.dataHash,
    dataHash: selectedHash, every, views, finalStateHash: hash(state) };
}
