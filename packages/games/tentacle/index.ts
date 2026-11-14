import { hash, validate, validateConfig, validateFrame, registerGame, validateGamePayload } from '../../contracts/index.ts';
import { xorshift32, pinData, assertPinned, emptyStatistics, statisticsDelta, clamp } from '../../sim/index.ts';
import { schemas, actions } from './schemas.ts';
import type { ActionSpec, GameData, InputFrame, MatchConfig, Observation, Outcome, State, Statistics, StepResult,
  TentacleRules } from '../../contracts/types.ts';
export { data } from './data.ts';
export { hash };
export const simVersion = 'tentacle-0.1.0';
registerGame('tentacle_run', 1, schemas);

// Sepia Tentacle Run: one seat (p1), 60 Hz, integer math. Positions are integers in the 16000 x 9000 arena.
// Per tick, in this order: the seat's inputs (latch, whip, move), the enemies, the projectiles, then the wave logic.
const SEAT = 'p1';
const WHIP_ARC_ACTIVE_TICKS = 8;
const LATCH_TICKS_MAX = 90;
const CONTACT_RANGE = 900;
const CONTACT_INTERVAL = 30;
const BOSS_CONTACT_RANGE = 1500;
const BOSS_CONTACT_INTERVAL = 40;
const PROJECTILE_RADIUS = 500;
const PROJECTILE_LIFE = 240;
const DRONE_SHOT_SPEED = 40;
const SENTRY_SHOT_SPEED = 70;
const BOSS_SHOT_SPEED = 50;
const LINE_TOLERANCE = 500;
const SENTRY_SPOTS = [[1000, 1000], [15000, 1000], [1000, 8000], [15000, 8000], [8000, 500], [8000, 8500],
  [500, 4500], [15500, 4500]];
// cos and sin of 15 degrees times 1000, for the boss's three-shot spread
const COS15 = 966, SIN15 = 259;

export const describe = () => ({
  gameId: 'tentacle_run',
  titleKey: 'game.tentacle_run',
  mode: 'realtime',
  minPlayers: 1,
  maxPlayers: 1,
  actions: structuredClone(actions)
});
export const makeConfig = (data: GameData, seed = 1, players: string[] = [SEAT], maxTicks = 7200): MatchConfig => ({
  contractVersion: '0.1',
  schemaVersion: 1,
  gameId: 'tentacle_run',
  simVersion,
  dataHash: pinData(data),
  seed,
  players,
  mode: 'realtime',
  maxTicks
});

/** Integer square root (Newton), so no floating point enters the state. */
export function isqrt(n: number): number {
  if (n < 2) return n;
  let x = n, y = Math.trunc((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.trunc((x + Math.trunc(n / x)) / 2);
  }
  return x;
}
const dist = (dx: number, dy: number) => isqrt(dx * dx + dy * dy);
/** The vector (dx, dy) scaled to `length` units, truncated. */
const toward = (dx: number, dy: number, length: number): [number, number] => {
  const d = dist(dx, dy) || 1;
  return [Math.trunc(dx * length / d) || 0, Math.trunc(dy * length / d) || 0]; // `|| 0`: never -0
};
const roll = (state: State, modulus: number): number => {
  state.rng = xorshift32(state.rng);
  return state.rng % modulus;
};
const waveRules = (rules: TentacleRules, wave: number) => rules.waves[Math.min(wave, rules.waves.length) - 1];

const statNames = (): string[] => ['move', 'latch', 'whip', ...[1, 2, 3, 4, 5, 6].flatMap(n =>
  [`wave:${n}:reached`, `wave:${n}:cleared`, `wave:${n}:damage`])];

export function initial(config: MatchConfig, data: GameData): State {
  validateConfig(config, data, describe(), simVersion);
  pinData(data);
  const rules = data.gameRules as TentacleRules;
  const state: State = {
    tick: 0,
    rng: config.seed,
    turnId: 0,
    payload: {
      config: structuredClone(config),
      wave: 1,
      fighting: false, // true from the spawn of a wave until its last enemy falls
      waveTick: 0,
      nextWaveTick: rules.betweenWavesTicks,
      nextId: 0,
      posts: structuredClone(rules.posts),
      bossPhases: rules.boss.phases,
      player: { id: SEAT, kind: 'player', x: 8000, y: 4500, hp: rules.player.health, maxHp: rules.player.health,
        facingX: 1000, facingY: 0, latch: null, latchReadyTick: 0, whipReadyTick: 0, invulnerableUntilTick: 0,
        whipUntilTick: 0 },
      enemies: [],
      projectiles: [],
      outcome: { status: 'running', winners: [], reason: 'in_progress' },
      statistics: emptyStatistics([SEAT], statNames())
    }
  };
  validateGamePayload('tentacle_run', 1, 'state', state.payload);
  return state;
}

export function observe(state: State, viewerId: string): Observation {
  const p = state.payload;
  const boss = p.enemies.find(e => e.kind === 'boss');
  const phases = p.bossPhases;
  const view = {
    tick: state.tick,
    viewerId,
    payload: {
      wave: p.wave,
      waveCount: 5,
      waveTick: p.waveTick,
      breakTicks: !p.fighting && p.outcome.status === 'running' ? Math.max(0, p.nextWaveTick - state.tick) : 0,
      entities: [structuredClone(p.player), ...p.enemies.map(e => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, hp: e.hp,
        maxHp: e.maxHp, facingX: e.facingX, facingY: e.facingY, latch: null, latchReadyTick: 0, whipReadyTick: 0,
        invulnerableUntilTick: 0, whipUntilTick: 0 }))],
      posts: structuredClone(p.posts),
      projectiles: structuredClone(p.projectiles),
      boss: boss ? { hp: boss.hp, maxHp: boss.maxHp, phase: Math.min(phases - 1, Math.trunc((boss.maxHp - boss.hp) *
        phases / boss.maxHp)), phases } : null,
      outcome: structuredClone(p.outcome)
    }
  };
  validate('Observation', view);
  validateGamePayload('tentacle_run', 1, 'observation', view.payload);
  return view;
}

export function legalActions(view: Observation): ActionSpec[] {
  validateGamePayload('tentacle_run', 1, 'observation', view.payload);
  const p = view.payload;
  if (view.viewerId !== SEAT || p.outcome.status !== 'running') return [];
  const me = p.entities[0];
  const specs = [structuredClone(actions[0])];
  if (me.latchReadyTick <= view.tick + 1 && !me.latch) specs.push(structuredClone(actions[1]));
  if (me.whipReadyTick <= view.tick + 1) specs.push(structuredClone(actions[2]));
  return specs;
}
export const outcome = (state: State): Outcome => structuredClone(state.payload.outcome);
export const statistics = (state: State): Statistics => structuredClone(state.payload.statistics);

export function step(state: State, frame: InputFrame, data: GameData): StepResult {
  assertPinned(state, data);
  if (state.payload.outcome.status !== 'running') throw Error('ILLEGAL_ACTION');
  const rules = data.gameRules as TentacleRules;
  validateFrame(state, frame, state.payload.config.players, actions, a => a.playerId === SEAT, true);
  if (frame.systemInputs.length) throw Error('ILLEGAL_ACTION');
  const next = structuredClone(state), q = next.payload, tick = frame.tick;
  next.tick = tick;
  const events: StepResult['events'] = [];
  const event = (kind: string, payload: Record<string, any>) => events.push({ eventId: `${tick}:${events.length}`,
    audience: [], kind, payload });
  const me = q.player;
  const mine = q.statistics.players[0];
  const stat = (id: string) => mine.actions.find(a => a.actionId === id);
  const wave: number = q.wave;
  const hurt = (amount: number) => {
    if (tick < me.invulnerableUntilTick || me.hp <= 0) return;
    const taken = Math.min(amount, me.hp);
    me.hp -= taken;
    stat(`wave:${wave}:damage`).uses += taken;
    event('player.hit', { amount: taken });
  };
  const spawn = (kind: string, x: number, y: number, hp: number, fire: number) => {
    q.enemies.push({ id: kind === 'boss' ? 'boss' : `e${q.nextId++}`, kind, x, y, hp, maxHp: hp, facingX: -1000, facingY: 0,
      nextFireTick: tick + fire, nextHitTick: tick + CONTACT_INTERVAL });
  };
  const shoot = (from: string, e: any, dx: number, dy: number, speed: number, damage: number) => {
    const [vx, vy] = toward(dx, dy, speed);
    q.projectiles.push({ id: `p${q.nextId++}`, x: e.x, y: e.y, vx, vy, life: PROJECTILE_LIFE, damage, from });
  };

  // 1. the seat's inputs
  let move: { moveX: number; moveY: number } | null = null;
  for (const a of frame.actions) {
    const ready = a.actionId === 'latch' ? me.latchReadyTick <= tick && !me.latch : a.actionId === 'whip' &&
      me.whipReadyTick <= tick;
    if (a.actionId === 'move') {
      move = { moveX: a.params.moveX, moveY: a.params.moveY };
      stat('move').opportunities++;
      stat('move').uses++;
      if (a.params.moveX || a.params.moveY) [me.facingX, me.facingY] = toward(a.params.moveX, a.params.moveY, 1000);
    } else if (a.actionId === 'latch') {
      stat('latch').opportunities++;
      if (!ready) continue;
      const { aimX, aimY } = a.params;
      let best = -1, bestD = Infinity;
      for (const post of q.posts) {
        const dx = post.x - me.x, dy = post.y - me.y, d2 = dx * dx + dy * dy;
        const dot = dx * aimX + dy * aimY;
        // within 45 degrees of the aim: dot > 0 and 2 dot^2 >= |d|^2 |aim|^2
        if (d2 === 0 || d2 > rules.player.latchRange ** 2 || dot <= 0 || 2 * dot * dot < d2 * (aimX * aimX + aimY * aimY)) continue;
        if (d2 < bestD) {
          best = post.id;
          bestD = d2;
        }
      }
      if (best < 0) continue;
      me.latch = { post: best, untilTick: tick + LATCH_TICKS_MAX };
      me.latchReadyTick = tick + rules.player.latchCooldownTicks;
      me.invulnerableUntilTick = tick + rules.player.latchInvulnerableTicks;
      [me.facingX, me.facingY] = toward(aimX, aimY, 1000);
      stat('latch').uses++;
      event('player.latch', { post: best });
    } else if (a.actionId === 'whip') {
      stat('whip').opportunities++;
      if (!ready) continue;
      const { aimX, aimY } = a.params;
      me.whipReadyTick = tick + rules.player.whipCooldownTicks;
      me.whipUntilTick = tick + WHIP_ARC_ACTIVE_TICKS;
      if (aimX || aimY) [me.facingX, me.facingY] = toward(aimX, aimY, 1000);
      stat('whip').uses++;
      let hits = 0;
      for (const e of q.enemies) {
        const dx = e.x - me.x, dy = e.y - me.y;
        if (dx * aimX + dy * aimY <= 0 || dx * dx + dy * dy > rules.player.whipRange ** 2) continue;
        e.hp = Math.max(0, e.hp - rules.player.whipDamage);
        mine.damage += rules.player.whipDamage;
        hits++;
      }
      event('player.whip', { hits });
      q.enemies = q.enemies.filter(e => e.hp > 0);
    }
  }
  // movement: a latch pulls Sepia to the post (and overrides the stick), otherwise the stick moves her
  if (me.latch) {
    const post = q.posts[me.latch.post];
    const dx = post.x - me.x, dy = post.y - me.y;
    if (dist(dx, dy) <= rules.player.latchSpeed || tick >= me.latch.untilTick) {
      if (dist(dx, dy) <= rules.player.latchSpeed) [me.x, me.y] = [post.x, post.y];
      me.latch = null;
    } else {
      const [vx, vy] = toward(dx, dy, rules.player.latchSpeed);
      me.x += vx;
      me.y += vy;
    }
  } else if (move) {
    me.x = clamp(me.x + Math.trunc(move.moveX * rules.player.speed / 1000), 0, rules.arena.w);
    me.y = clamp(me.y + Math.trunc(move.moveY * rules.player.speed / 1000), 0, rules.arena.h);
  }

  // 2. wave start
  if (!q.fighting && tick >= q.nextWaveTick) {
    q.fighting = true;
    const w = waveRules(rules, q.wave);
    q.waveTick = 0;
    stat(`wave:${q.wave}:reached`).uses = 1;
    stat(`wave:${q.wave}:cleared`).opportunities = 1;
    const edge = () => {
      const side = roll(next, 4);
      return side < 2 ? [roll(next, rules.arena.w + 1), side ? rules.arena.h : 0] :
        [side === 2 ? 0 : rules.arena.w, roll(next, rules.arena.h + 1)];
    };
    if (q.wave <= 5) {
      for (let i = 0; i < w.walkers; i++) spawn('walker', ...(edge() as [number, number]), rules.enemies.walker.health, 0);
      for (let i = 0; i < w.drones; i++) spawn('drone', ...(edge() as [number, number]), rules.enemies.drone.health,
        w.fireIntervalTicks);
      for (let i = 0; i < w.sentries; i++) {
        const [x, y] = SENTRY_SPOTS[i % SENTRY_SPOTS.length];
        spawn('sentry', x, y, rules.enemies.sentry.health, w.fireIntervalTicks);
      }
    } else spawn('boss', 14000, 4500, rules.boss.health, rules.boss.fireIntervalTicks);
    event('wave.start', { wave: q.wave });
  } else if (q.fighting) q.waveTick++;

  // 3. enemies
  const w = waveRules(rules, q.wave);
  for (const e of q.enemies) {
    const dx = me.x - e.x, dy = me.y - e.y, d = dist(dx, dy);
    if (e.kind === 'walker') {
      const [vx, vy] = toward(dx, dy, Math.min(w.enemySpeed, d));
      e.x += vx;
      e.y += vy;
      [e.facingX, e.facingY] = toward(dx, dy, 1000);
      if (d <= CONTACT_RANGE && tick >= e.nextHitTick) {
        hurt(w.enemyDamage);
        e.nextHitTick = tick + CONTACT_INTERVAL;
      }
    } else if (e.kind === 'drone') {
      const speed = Math.trunc(w.enemySpeed * 3 / 4);
      if (d > 5200) [e.x, e.y] = [e.x + toward(dx, dy, speed)[0], e.y + toward(dx, dy, speed)[1]];
      else if (d < 4000) [e.x, e.y] = [e.x - toward(dx, dy, speed)[0], e.y - toward(dx, dy, speed)[1]];
      e.x = clamp(e.x, 0, rules.arena.w);
      e.y = clamp(e.y, 0, rules.arena.h);
      [e.facingX, e.facingY] = toward(dx, dy, 1000);
      if (tick >= e.nextFireTick) {
        shoot('drone', e, dx, dy, DRONE_SHOT_SPEED, w.enemyDamage);
        e.nextFireTick = tick + w.fireIntervalTicks;
      }
    } else if (e.kind === 'sentry') {
      [e.facingX, e.facingY] = toward(dx, dy, 1000);
      const inLine = Math.abs(dx) <= LINE_TOLERANCE || Math.abs(dy) <= LINE_TOLERANCE ||
        Math.abs(Math.abs(dx) - Math.abs(dy)) <= LINE_TOLERANCE;
      if (inLine && tick >= e.nextFireTick) {
        shoot('sentry', e, dx, dy, SENTRY_SHOT_SPEED, w.enemyDamage);
        e.nextFireTick = tick + w.fireIntervalTicks;
      }
    } else {
      const [vx, vy] = toward(dx, dy, Math.min(rules.boss.speed, d));
      e.x += vx;
      e.y += vy;
      [e.facingX, e.facingY] = toward(dx, dy, 1000);
      if (d <= BOSS_CONTACT_RANGE && tick >= e.nextHitTick) {
        hurt(rules.boss.contactDamage);
        e.nextHitTick = tick + BOSS_CONTACT_INTERVAL;
      }
      if (tick >= e.nextFireTick) {
        for (const [c, sn] of [[1000, 0], [COS15, SIN15], [COS15, -SIN15]]) {
          shoot('boss', e, Math.trunc((dx * c - dy * sn) / 1000), Math.trunc((dx * sn + dy * c) / 1000), BOSS_SHOT_SPEED,
            rules.boss.shotDamage);
        }
        e.nextFireTick = tick + rules.boss.fireIntervalTicks;
      }
    }
  }

  // 4. projectiles
  q.projectiles = q.projectiles.filter(shot => {
    shot.x += shot.vx;
    shot.y += shot.vy;
    shot.life--;
    const dx = me.x - shot.x, dy = me.y - shot.y;
    if (dx * dx + dy * dy <= PROJECTILE_RADIUS ** 2) {
      hurt(shot.damage);
      return false;
    }
    return shot.life > 0 && shot.x > -1000 && shot.x < rules.arena.w + 1000 && shot.y > -1000 && shot.y < rules.arena.h + 1000;
  });

  // 5. wave clear, death, time
  if (me.hp <= 0) q.outcome = { status: 'draw', winners: [], reason: 'death' };
  else if (q.fighting && q.enemies.length === 0 && q.waveTick > 0) {
    q.fighting = false;
    stat(`wave:${q.wave}:cleared`).uses = 1;
    event('wave.clear', { wave: q.wave });
    if (q.wave >= 6) q.outcome = { status: 'win', winners: [SEAT], reason: 'boss_down' };
    else {
      q.wave++;
      q.waveTick = 0;
      q.nextWaveTick = tick + rules.betweenWavesTicks;
      me.hp = Math.min(me.maxHp, me.hp + rules.healOnClear);
    }
  }
  if (q.outcome.status === 'running' && tick >= q.config.maxTicks) q.outcome = { status: 'draw', winners: [],
    reason: 'max_ticks' };
  q.statistics.durationTicks = tick;
  if (q.outcome.status !== 'running') {
    mine.wins = q.outcome.status === 'win' ? 1 : 0;
    mine.draws = q.outcome.status === 'draw' ? 1 : 0;
  }
  return { state: next, events, outcome: outcome(next), statisticsDelta: statisticsDelta(state.payload.statistics,
    q.statistics) };
}

export const adapter = { describe, initial, observe, legalActions, step, outcome, statistics, hash };
