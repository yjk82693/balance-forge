import { hash, compareIds, validate } from '../contracts/index.js';
export function xorshift32(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4294967295) throw Error('INVALID_SCHEMA');
  let x = value >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const pinned = new WeakMap();
export function pinData(data) {
  const digest = hash(data);
  deepFreeze(data);
  pinned.set(data, digest);
  return digest;
}
export const dataHash = data => pinned.get(data) ?? hash(data);
export function assertPinned(state, data) {
  if (state.payload.config.dataHash !== dataHash(data)) throw Error('HASH_MISMATCH');
}
export function emptyStatistics(players, actions) {
  return {
    players: [...players].sort(compareIds).map(playerId => ({
      playerId,
      wins: 0,
      draws: 0,
      damage: 0,
      actions: actions.map(actionId => ({
        actionId,
        opportunities: 0,
        uses: 0
      }))
    })),
    durationTicks: 0
  };
}
export function statisticsDelta(before, after) {
  return {
    durationTicks: after.durationTicks - before.durationTicks,
    players: after.players.map((p, i) => ({
      ...p,
      wins: p.wins - before.players[i].wins,
      draws: p.draws - before.players[i].draws,
      damage: p.damage - before.players[i].damage,
      actions: p.actions.map((a, j) => ({
        ...a,
        uses: a.uses - before.players[i].actions[j].uses,
        opportunities: a.opportunities - before.players[i].actions[j].opportunities
      }))
    }))
  };
}
// The only state owner for controllers and bots. Accepted frames, not arrivals, are replayed.
export class Authority {
  constructor(adapter, config, data) {
    this.adapter = adapter;
    this.data = data;
    this.config = structuredClone(config);
    this.state = adapter.initial(config, data);
    this.receipts = new Map();
    this.lastSeq = new Map();
    this.pending = new Map();
    this.frames = [];
    // Held movement: seat -> last accepted non-zero move vector. Only seats listed in holdMoves (human seats) hold;
    // bots send a move every tick themselves. The held vector is re-sent by the server on ticks without a new move.
    this.holdMoves = new Set();
    this.held = new Map();
  }
  // Drops a seat's held movement (disconnect, or any other reason the seat can no longer move).
  release(playerId) {
    this.held.delete(playerId);
  }
  trackHold(action) {
    const holds = this.config.gameId === 'hero_arena' && action.actionId === 'move';
    if (!holds || !this.holdMoves.has(action.playerId)) return;
    const { moveX, moveY } = action.params;
    if (moveX === 0 && moveY === 0) this.held.delete(action.playerId);
    else this.held.set(action.playerId, { moveX, moveY });
  }
  // Server-generated move for every held seat that sent no move for this tick. It never carries an attack, is part of
  // the accepted frame (so replays reproduce it), and does not touch receipts or the seat's sequence numbers: it reuses
  // the seat's latest sequence number, or the one just below a queued attack, so state.lastSeq never moves backwards.
  injectHeldMoves() {
    const tick = this.state.tick + 1;
    for (const [playerId, vector] of [...this.held]) {
      const queued = this.pending.get(playerId) ?? [];
      if (queued.some(a => a.actionId === 'move')) continue;
      const attack = queued.find(a => a.actionId !== 'move');
      const seq = attack ? attack.seq - 1 : this.lastSeq.get(playerId) ?? 0;
      const move = {
        playerId,
        seq,
        tick,
        turnId: this.state.turnId,
        actionId: 'move',
        params: { ...vector }
      };
      try {
        validate('ActionInput', move);
        if (seq < 0) throw Error('ILLEGAL_ACTION');
        // The same pure-copy check as submit: a stunned or knocked-out seat cannot move, so its hold ends.
        this.adapter.step(this.state, {
          tick,
          actions: [...queued, move].sort((a, b) => a.seq - b.seq),
          systemInputs: []
        }, this.data);
      } catch {
        this.held.delete(playerId);
        continue;
      }
      this.pending.set(playerId, [...queued, move]);
    }
  }
  submit(action) {
    validate('ActionInput', action);
    const key = JSON.stringify([action.playerId, action.seq]);
    if (this.receipts.has(key)) return structuredClone(this.receipts.get(key));
    if (!this.config.players.includes(action.playerId)) throw Error('ILLEGAL_ACTION');
    if (action.seq <= (this.lastSeq.get(action.playerId) ?? -1)) throw Error('ILLEGAL_ACTION');
    if (action.tick !== this.state.tick + 1) throw Error('LATE_INPUT');
    if (action.turnId !== this.state.turnId) throw Error('STALE_TURN');
    const category = a => this.config.gameId === 'hero_arena' && a.actionId === 'move' ? 'move' : 'attack';
    const queued = this.pending.get(action.playerId) ?? [];
    if (queued.some(a => category(a) === category(action))) throw Error('RATE_LIMITED');
    // Adapter performs the exact same validation that advance will use, on a pure copy.
    this.adapter.step(this.state, {
      tick: action.tick,
      actions: [...queued, action].sort((a, b) => a.seq - b.seq),
      systemInputs: []
    }, this.data);
    this.pending.set(action.playerId, [...queued, structuredClone(action)]);
    const receipt = {
      seq: action.seq,
      status: 'accepted',
      acceptedTick: action.tick
    };
    this.receipts.set(key, receipt);
    this.lastSeq.set(action.playerId, action.seq);
    this.trackHold(action);
    return structuredClone(receipt);
  }
  advance(systemInputs = []) {
    if (this.held.size) this.injectHeldMoves();
    const frame = {
      tick: this.state.tick + 1,
      actions: [...this.pending.values()].flat().sort((a, b) => compareIds(a.playerId, b.playerId) || a.seq - b.seq),
      systemInputs: structuredClone(systemInputs)
    };
    const result = this.adapter.step(this.state, frame, this.data);
    this.state = result.state;
    this.pending.clear();
    this.frames.push(frame);
    if (this.held.size && this.adapter.outcome(this.state).status !== 'running') this.held.clear();
    return result;
  }
}
export function replay(adapter, config, data, frames, {
  onStep
} = {}) {
  let state = adapter.initial(config, data);
  if (onStep !== undefined && typeof onStep !== 'function') throw Error('INVALID_SCHEMA');
  onStep?.({
    state: structuredClone(state),
    events: [],
    frame: null
  });
  for (const frame of frames) {
    const result = adapter.step(state, frame, data);
    state = result.state;
    onStep?.({
      state: structuredClone(state),
      events: structuredClone(result.events),
      frame: structuredClone(frame)
    });
  }
  return state;
}
// Counterfactual playback changes only the immutable data pin, preserving seed, assignments and accepted inputs.
// If the candidate makes a recorded action illegal, replay throws instead of silently replacing that input.
export function replayOnData(adapter, recording, data, options) {
  const config = {
    ...structuredClone(recording.config),
    dataHash: pinData(data)
  };
  return replay(adapter, config, data, recording.frames, options);
}
