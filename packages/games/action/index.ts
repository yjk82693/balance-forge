import { hash, validate, validateData, registerGame, validateGamePayload, validateConfig, validateFrame,
  compareIds } from '../../contracts/index.ts';
import { clamp, xorshift32, pinData, assertPinned, emptyStatistics, statisticsDelta } from '../../sim/index.ts';
import { actions, schemas } from './schemas.ts';
import type { ActionSpec, GameData, InputFrame, MatchConfig, Observation, Outcome, State, Statistics,
  StepResult } from '../../contracts/types.ts';
export { data } from './data.ts';
export { hash };
export const simVersion = 'arena-0.1.2';
registerGame('hero_arena', 1, schemas);
const ids: string[] = actions.filter(a => a.actionId !== 'move').map(a => a.actionId);
export const describe = () => ({
  gameId: 'hero_arena',
  titleKey: 'game.hero_arena',
  mode: 'realtime',
  minPlayers: 2,
  maxPlayers: 2,
  actions: structuredClone(actions)
});
function defaultAssignments(data: GameData, players: string[]): Record<string, string> {
  validateData(data);
  if (!data.characters.length || !Array.isArray(players)) throw Error('INVALID_SCHEMA');
  return Object.fromEntries(players.map((id, index) => [id, data.characters[index % data.characters.length].id]));
}
export function makeConfig(data: GameData, seed = 1, players: string[] = ['p1', 'p2'], maxTicks = 1800,
  assignments?: Record<string, string>): MatchConfig {
  assignments ??= defaultAssignments(data, players);
  return {
    contractVersion: '0.1',
    schemaVersion: 1,
    gameId: 'hero_arena',
    simVersion,
    dataHash: pinData(data),
    seed,
    players,
    mode: 'realtime',
    maxTicks,
    options: {
      assignments
    }
  };
}
export function initial(config: MatchConfig, data: GameData): State {
  validateConfig(config, data, describe(), simVersion);
  if (config.maxTicks > 1800) throw Error('INVALID_SCHEMA');
  const assigned = config.options?.assignments ?? defaultAssignments(data, config.players);
  for (const id of config.players.map(id => assigned[id])) {
    if (!data.characters.some(c => c.id === id)) throw Error('INVALID_SCHEMA');
    const c = data.characters.find(c => c.id === id);
    const archetypes = c.moveIds.map(id => data.moves.find(m => m.id === id)?.archetype as string);
    if (ids.some(a => !archetypes.includes(a))) throw Error(
      'INVALID_SCHEMA');
  }
  for (const t of data.gameRules.moveTraits) if (!data.moves.some(m => m.id === t.moveId)) throw Error(
    'INVALID_SCHEMA');
  pinData(data);
  const entities = config.players.map((id, i) => ({
    id,
    hero: assigned[id],
    x: i === 0 ? 4200 : 11800,
    y: 4500,
    hp: data.characters.find(c => c.id === assigned[id]).health,
    maxHp: data.characters.find(c => c.id === assigned[id]).health,
    facing: i === 0 ? 0 : 180,
    cooldowns: [0, 0, 0],
    guardUntil: 0,
    shield: 0,
    stunUntil: 0,
    recoveryUntil: 0,
    lastSeq: -1,
    pending: {
      actionId: '',
      due: 0,
      aimX: 0,
      aimY: 0
    }
  })).sort((a, b) => compareIds(a.id, b.id));
  const rng = xorshift32(config.seed);
  for (const e of entities) e.y += rng % 201 - 100;
  const state = {
    tick: 0,
    rng,
    turnId: 0,
    payload: {
      config: structuredClone(config),
      entities,
      projectiles: [],
      nextProjectile: 0,
      hitStop: 0,
      outcome: {
        status: 'running',
        winners: [],
        reason: 'in_progress'
      },
      statistics: emptyStatistics(config.players, ids)
    }
  };
  validateGamePayload('hero_arena', 1, 'state', state.payload);
  return state;
}
const ready = (e, tick, hitStop) => e.hp > 0 && !hitStop && !e.pending.actionId && e.stunUntil <= tick &&
  e.recoveryUntil <= tick;
function available(e, tick, hitStop) {
  if (e.hp <= 0 || e.stunUntil > tick) return [];
  return actions.filter((a, i) => a.actionId === 'move' || ready(e, tick, hitStop) && e.cooldowns[i] <= tick);
}
export function observe(state: State, viewerId: string): Observation {
  const view = {
    tick: state.tick,
    viewerId,
    payload: {
      arena: {
        w: 16000,
        h: 9000
      },
      entities: structuredClone(state.payload.entities),
      projectiles: structuredClone(state.payload.projectiles),
      outcome: structuredClone(state.payload.outcome),
      hitStop: state.payload.hitStop
    }
  };
  validate('Observation', view);
  validateGamePayload('hero_arena', 1, 'observation', view.payload);
  return view;
}
export function legalActions(view: Observation): ActionSpec[] {
  validateGamePayload('hero_arena', 1, 'observation', view.payload);
  if (view.payload.outcome.status !== 'running') return [];
  const e = view.payload.entities.find(e => e.id === view.viewerId);
  return e ? structuredClone(available(e, view.tick + 1, view.payload.hitStop)) : [];
}
export const outcome = (state: State): Outcome => structuredClone(state.payload.outcome);
export const statistics = (state: State): Statistics => structuredClone(state.payload.statistics);
const distance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const quotient = (a, b) => Math.trunc(a / b) || 0;
function moveFor(data, e, actionId) {
  const c = data.characters.find(c => c.id === e.hero);
  return data.moves.find(m => c.moveIds.includes(m.id) && m.archetype === actionId);
}
function applyMovement({
  payload,
  data
}, frame) {
  for (const a of frame.actions) {
    const e = payload.entities.find(e => e.id === a.playerId);
    e.lastSeq = a.seq;
    if (a.actionId === 'move') {
      const c = data.characters.find(c => c.id === e.hero);
      e.x = clamp(e.x + quotient(a.params.moveX * c.speed, 1000), 0, 16000);
      e.y = clamp(e.y + quotient(a.params.moveY * c.speed, 1000), 0, 9000);
      if (a.params.moveX) e.facing = a.params.moveX < 0 ? 180 : 0;
    }
  }
}
function freezeTimers({
  payload,
  tick
}) {
  payload.hitStop--;
  for (const e of payload.entities) {
    for (const key of ['guardUntil', 'stunUntil', 'recoveryUntil']) if (e[key] >= tick) e[key]++;
    e.cooldowns = e.cooldowns.map(n => n >= tick ? n + 1 : n);
    if (e.pending.actionId) e.pending.due++;
  }
}
function startAttacks({
  payload,
  data,
  tick,
  event,
  statsFor
}, frame) {
  for (const a of frame.actions) {
    const e = payload.entities.find(e => e.id === a.playerId);
    if (a.actionId === 'move') continue;
    const m = moveFor(data, e, a.actionId),
      tier = data.weightTiers[m.weightTier];
    if (a.params.aimX) e.facing = a.params.aimX < 0 ? 180 : 0;
    e.pending = {
      actionId: a.actionId,
      due: tick + tier.startupTicks,
      aimX: a.params.aimX ?? 0,
      aimY: a.params.aimY ?? 0
    };
    e.cooldowns[ids.indexOf(a.actionId)] = tick + tier.cooldownTicks;
    e.recoveryUntil = tick + tier.startupTicks + tier.recoveryTicks;
    statsFor(e.id).actions[ids.indexOf(a.actionId)].uses++;
    event('action.used', {
      playerId: e.id,
      actionId: a.actionId
    });
  }
}
function resolvePendingMoves({
  payload,
  data,
  tick,
  event
}) {
  const hits = [];
  for (const e of payload.entities) {
    if (!e.pending.actionId || e.pending.due > tick || e.hp <= 0) continue;
    const pending = e.pending,
      m = moveFor(data, e, pending.actionId);
    e.pending = {
      actionId: '',
      due: 0,
      aimX: 0,
      aimY: 0
    };
    if (m.archetype === 'guard') {
      const shield = m.effects.find(f => f.operator === 'shield');
      e.guardUntil = tick + (shield?.durationTicks ?? data.gameRules.guardDuration);
      e.shield = shield?.amount ?? 100;
      event('combat.guard', {
        playerId: e.id,
        phase: 'activate',
        x: e.x,
        y: e.y,
        until: e.guardUntil
      });
    } else if (m.archetype === 'melee') {
      for (const target of payload.entities) if (target.id !== e.id && target.hp > 0 && distance(e,
        target) <= data.gameRules.meleeRange ** 2) hits.push({
        owner: e.id,
        target: target.id,
        moveId: m.id,
        power: m.power,
        ignoresGuard: false
      });
    } else {
      const norm = Math.max(Math.abs(pending.aimX), Math.abs(pending.aimY), 1);
      payload.projectiles.push({
        id: `pr${payload.nextProjectile++}`,
        owner: e.id,
        kind: m.id,
        x: e.x,
        y: e.y,
        vx: quotient(pending.aimX * data.gameRules.projectileSpeed, norm),
        vy: quotient(pending.aimY * data.gameRules.projectileSpeed, norm),
        life: data.gameRules.projectileLife,
        power: m.power,
        moveId: m.id,
        ignoresGuard: data.gameRules.moveTraits.find(t => t.moveId === m.id)?.ignoresGuard ?? false
      });
      event('projectile.spawn', {
        ...payload.projectiles.at(-1)
      });
    }
  }
  return hits;
}
function advanceProjectiles({
  payload,
  data,
  event
}, hits) {
  const surviving = [];
  for (const shot of payload.projectiles.sort((a, b) => compareIds(a.id, b.id))) {
    shot.x += shot.vx;
    shot.y += shot.vy;
    shot.life--;
    const target = payload.entities.find(e => e.id !== shot.owner && e.hp > 0 && distance(shot,
      e) <= data.gameRules.projectileRadius ** 2);
    if (target) {
      hits.push({
        ...shot,
        target: target.id
      });
      event('projectile.expire', {
        id: shot.id,
        owner: shot.owner,
        x: shot.x,
        y: shot.y,
        reason: 'hit'
      });
    } else if (shot.life > 0 && shot.x >= 0 && shot.x <= 16000 && shot.y >= 0 && shot.y <= 9000) {
      surviving.push(shot);
    } else {
      event('projectile.expire', {
        id: shot.id,
        owner: shot.owner,
        x: shot.x,
        y: shot.y,
        reason: shot.life <= 0 ? 'lifetime' : 'bounds'
      });
    }
  }
  payload.projectiles = surviving;
}
function applyHits({
  payload,
  data,
  tick,
  event,
  statsFor
}, hits) {
  for (const hit of hits) {
    const source = payload.entities.find(e => e.id === hit.owner),
      target = payload.entities.find(e => e.id === hit.target),
      m = data.moves.find(m => m.id === hit.moveId),
      tier = data.weightTiers[m.weightTier];
    const guarded = target.guardUntil > tick && !hit.ignoresGuard;
    if (guarded) event('combat.guard', {
      playerId: target.id,
      phase: 'block',
      source: source.id,
      x: target.x,
      y: target.y
    });
    let amount = quotient((hit.power + m.effects.filter(e => e.operator === 'damage').reduce((n, e) => n + e.amount,
      0)) * data.tuning.damageScalePermille, 1000);
    if (guarded) amount = quotient(amount * (100 - clamp(target.shield, 0, 100)), 100);
    amount = clamp(amount, 0, target.hp);
    target.hp -= amount;
    statsFor(source.id).damage += amount;
    if (amount > 0) {
      target.stunUntil = Math.max(target.stunUntil, tick + tier.stunTicks);
      target.pending = {
        actionId: '',
        due: 0,
        aimX: 0,
        aimY: 0
      };
      const knockback = tier.knockback + m.effects.filter(e => e.operator === 'knockback').reduce((n, e) =>
        n + e.amount, 0);
      target.x = clamp(target.x + (target.x >= source.x ? 1 : -1) * knockback, 0, 16000);
      payload.hitStop = Math.max(payload.hitStop, tier.hitStopTicks);
      for (const effect of m.effects) {
        if (effect.operator === 'cooldown') target.cooldowns = target.cooldowns.map(n => clamp(n + effect.amount, 0,
          2147483647));
        if (effect.operator === 'shield') {
          source.shield = clamp(effect.amount, 0, 1000000);
          source.guardUntil = tick + effect.durationTicks;
        }
      }
    }
    event('combat.hit', {
      source: source.id,
      target: target.id,
      amount,
      guarded,
      ignoresGuard: hit.ignoresGuard,
      x: target.x,
      y: target.y
    });
    if (amount > 0 && target.hp === 0) event('combat.ko', {
      playerId: target.id,
      source: source.id,
      x: target.x,
      y: target.y
    });
  }
}
function finishTick(payload, tick) {
  const alive = payload.entities.filter(e => e.hp > 0);
  if (alive.length < 2) payload.outcome = alive.length === 1 ? {
    status: 'win',
    winners: [alive[0].id],
    reason: 'hp_zero'
  } : {
    status: 'draw',
    winners: [],
    reason: 'mutual_elimination'
  };else if (tick >= payload.config.maxTicks) payload.outcome = {
    status: 'draw',
    winners: [],
    reason: 'max_ticks'
  };
  payload.statistics.durationTicks = tick;
  if (payload.outcome.status !== 'running') for (const s of payload.statistics.players) {
    s.wins = payload.outcome.winners.includes(s.playerId) ? 1 : 0;
    s.draws = payload.outcome.status === 'draw' ? 1 : 0;
  }
}
export function step(state: State, frame: InputFrame, data: GameData): StepResult {
  assertPinned(state, data);
  if (state.payload.outcome.status !== 'running') throw Error('ILLEGAL_ACTION');
  const players = state.payload.config.players;
  validateFrame(state, frame, players, actions, a => {
    const e = state.payload.entities.find(e => e.id === a.playerId);
    // A move may repeat the seat's latest sequence number: the room re-sends a held stick as a server-generated move
    // (see Authority.injectHeldMoves). Clients cannot do this; Authority.submit still requires strictly rising seq.
    const freshSeq = a.actionId === 'move' ? a.seq >= e.lastSeq : a.seq > e.lastSeq;
    return freshSeq && available(e, frame.tick, state.payload.hitStop).some(s =>
      s.actionId === a.actionId) && (a.actionId !== 'projectile' || a.params.aimX !== 0 || a.params.aimY !== 0);
  }, true);
  if (frame.systemInputs.length) throw Error('ILLEGAL_ACTION');
  const next = structuredClone(state),
    payload = next.payload,
    tick = frame.tick,
    events = [];
  next.tick = tick;
  const event = (kind, payload) => events.push({
    eventId: `${tick}:${events.length}`,
    audience: [],
    kind,
    payload
  });
  const statsFor = id => payload.statistics.players.find(s => s.playerId === id);
  for (const e of payload.entities) for (const spec of available(e, tick, payload.hitStop).filter(a =>
    a.actionId !== 'move')) statsFor(e.id).actions[ids.indexOf(spec.actionId)].opportunities++;
  const context = {
    payload,
    data,
    tick,
    event,
    statsFor
  };
  applyMovement(context, frame);
  if (payload.hitStop > 0) freezeTimers(context);else {
    startAttacks(context, frame);
    const hits = resolvePendingMoves(context);
    advanceProjectiles(context, hits);
    applyHits(context, hits);
  }
  finishTick(payload, tick);
  return {
    state: next,
    events,
    outcome: outcome(next),
    statisticsDelta: statisticsDelta(state.payload.statistics, payload.statistics)
  };
}
export const adapter = {
  describe,
  initial,
  observe,
  legalActions,
  step,
  outcome,
  statistics,
  hash
};
