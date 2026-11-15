import { hash, validate, validateConfig, validateFrame, registerGame,
  validateGamePayload } from '../../contracts/index.ts';
import { xorshift32, pinData, assertPinned, emptyStatistics, statisticsDelta } from '../../sim/index.ts';
import { schemas, actions } from './schemas.ts';
import type { ActionSpec, GameData, InputFrame, MatchConfig, Observation, Outcome, State, Statistics, StepResult,
  TentacleRules } from '../../contracts/types.ts';
export { data } from './data.ts';
export { hash };
export const simVersion = 'tentacle-0.2.0';
registerGame('tentacle_run', 1, schemas);

// Sepia Tentacle Run, a side-scrolling wire runner. One seat (p1), 60 Hz, integer math. x grows right, y grows UP with
// the ground at y = 0. Per tick, in this order: the control input, Sepia's movement (running, jumping, sliding or
// swinging on the wire), collisions, then section bookkeeping and the outcome.
const SEAT = 'p1';
const FALL_DEATH_Y = -3000;
const SPAWN_LEAD = 4000; // free run at the start of every section before its first obstacle
const ATTACH_MIN_RISE = 1000; // the anchor must be at least this far above Sepia's head to take the wire
const ATTACH_BEHIND = 2000; // an anchor up to this far behind Sepia can still be taken (wide hook magnetism)
const COYOTE_TICKS = 6; // a jump still works this long after Sepia left the ground
const JUMP_BUFFER_TICKS = 7; // a jump pressed this long before landing fires on landing
const PIT_GRACE = 500; // how far below the ground over a pit before it is a fall (room for a coyote jump)
const SWING_MAX_SPEED = 40; // per axis, so a swing never gets too fast

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
const roll = (state: State, modulus: number): number => {
  state.rng = xorshift32(state.rng);
  return state.rng % modulus;
};

const statNames = (): string[] => ['control',
  ...[1, 2, 3, 4, 5, 6].flatMap(n => [`wave:${n}:reached`, `wave:${n}:cleared`])];

/** The course: obstacles and anchors of every section, generated once from the seed and the section data. */
function buildCourse(state: State, rules: TentacleRules) {
  const obstacles = [], anchors = [], bounds = [];
  let start = rules.leadIn;
  rules.sections.forEach((section, index) => {
    const n = index + 1, end = start + section.length;
    bounds.push({ start, end });
    const kinds = [...Array(section.pits).fill('pit'), ...Array(section.lowBars).fill('lowBar'),
      ...Array(section.walls).fill('wall')];
    for (let i = kinds.length - 1; i > 0; i--) { // seeded shuffle
      const j = roll(state, i + 1);
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    const room = section.length - SPAWN_LEAD - 3000;
    const gap = kinds.length ? Math.trunc(room / kinds.length) : 0;
    kinds.forEach((kind, i) => {
      const x = start + SPAWN_LEAD + i * gap + roll(state, Math.max(1, Math.trunc(gap / 4)));
      const o = rules.obstacles;
      if (kind === 'pit') {
        obstacles.push({ id: `o${obstacles.length}`, kind, x, w: o.pitWidth, y: 0, h: 0, section: n });
      }
      else if (kind === 'lowBar') obstacles.push({ id: `o${obstacles.length}`, kind, x, w: o.lowBarWidth,
        y: o.lowBarBottom, h: o.lowBarTop - o.lowBarBottom, section: n });
      else obstacles.push({ id: `o${obstacles.length}`, kind, x, w: o.wallWidth, y: 0, h: o.wallHeight, section: n });
    });
    for (let x = start + 1000 + roll(state, 400); x < end; x += section.anchorSpacing) {
      anchors.push({ id: `a${anchors.length}`, x, y: rules.obstacles.anchorHeight, section: n });
    }
    start = end;
  });
  return { obstacles, anchors, bounds, finishX: start };
}

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
      input: { jump: 0, slide: 0 },
      player: { x: 0, y: 0, vx: rules.sections[0].runSpeed, vy: 0, state: 'running', height: rules.player.height,
        jumpHeldTicks: 0, airTicks: 0, jumpBuffer: 0, jumped: false, wire: null },
      outcome: { status: 'running', winners: [], reason: 'in_progress' },
      statistics: emptyStatistics([SEAT], statNames())
    }
  };
  Object.assign(state.payload, buildCourse(state, rules));
  validateGamePayload('tentacle_run', 1, 'state', state.payload);
  return state;
}

const sectionAt = (bounds: Array<{ start: number; end: number }>, x: number): number => {
  for (let i = 0; i < bounds.length; i++) if (x < bounds[i].end) return i;
  return bounds.length - 1;
};

export const observationCheck = { every: 30 };
export function observe(state: State, viewerId: string): Observation {
  const p = state.payload;
  const cameraX = Math.max(0, p.player.x - 4000), width = 16000;
  const near = (o: { x: number; w?: number }) => o.x + (o.w ?? 0) >= cameraX - 1000 && o.x <= cameraX + width + 1000;
  const index = sectionAt(p.bounds, p.player.x);
  const view = {
    tick: state.tick,
    viewerId,
    payload: {
      section: index + 1,
      sectionCount: 6,
      sectionStartX: p.bounds[index].start,
      sectionEndX: p.bounds[index].end,
      cameraX,
      viewWidth: width,
      finishX: p.finishX,
      player: structuredClone(p.player),
      obstacles: p.obstacles.filter(near).map(o => ({ ...o })),
      anchors: p.anchors.filter(near).map(a => ({ ...a })),
      shark: index === 5 ? { x: Math.max(0, p.player.x - 5000) } : null,
      outcome: structuredClone(p.outcome)
    }
  };
  // Checking the schema costs more than the rest of a tick, so a view is validated every `observationCheck.every`
  // ticks (every tick in the tests): a shape error shows within half a second of play, and runs stay fast.
  if (state.tick % observationCheck.every === 0) {
    validate('Observation', view);
    validateGamePayload('tentacle_run', 1, 'observation', view.payload);
  }
  return view;
}

export function legalActions(view: Observation): ActionSpec[] {
  const p = view.payload;
  if (view.viewerId !== SEAT || p.outcome.status !== 'running') return [];
  return [structuredClone(actions[0])];
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
  const mine = q.statistics.players[0];
  const stat = (id: string) => mine.actions.find(a => a.actionId === id);
  const ph = rules.physics, p = q.player;

  // 1. the control input (the last one stays until a new one arrives)
  for (const a of frame.actions) {
    q.input = { jump: a.params.jump, slide: a.params.slide };
    stat('control').uses++;
    stat('control').opportunities++;
  }
  const jump = q.input.jump === 1, slide = q.input.slide === 1;
  p.jumpHeldTicks = jump ? p.jumpHeldTicks + 1 : 0;
  const index = sectionAt(q.bounds, p.x);
  const speed = rules.sections[index].runSpeed;
  const supported = (x: number) => !q.obstacles.some(o => o.kind === 'pit' && x >= o.x && x < o.x + o.w);

  // 2. movement
  if (p.state === 'swinging') {
    const wire = p.wire;
    if (!jump) { // let go: keep the momentum, with a small upward kick
      p.wire = null;
      p.state = 'jumping';
      p.vy += ph.releaseBoost;
      event('wire.release', {});
    } else {
      wire.length = Math.max(ph.wireMinLength, wire.length - ph.reelSpeed);
      p.vy -= ph.swingGravity;
      p.x += p.vx;
      p.y += p.vy;
      let dx = p.x - wire.anchorX, dy = p.y - wire.anchorY;
      const d = isqrt(dx * dx + dy * dy);
      if (d > wire.length) { // the rope is taut: put Sepia back on the circle and drop the outward speed
        const nx = Math.trunc(dx * wire.length / d), ny = Math.trunc(dy * wire.length / d);
        const radial = Math.trunc((p.vx * dx + p.vy * dy) / d); // speed along the rope, outward is positive
        p.x = wire.anchorX + nx;
        p.y = wire.anchorY + ny;
        if (radial > 0) {
          p.vx -= Math.trunc(radial * dx / d);
          p.vy -= Math.trunc(radial * dy / d);
        }
        dx = nx;
        dy = ny;
      }
      p.vx = Math.max(-SWING_MAX_SPEED, Math.min(SWING_MAX_SPEED, p.vx));
      p.vy = Math.max(-SWING_MAX_SPEED, Math.min(SWING_MAX_SPEED, p.vy));
      if (p.y <= 0) { // swung into the ground: land and run on
        p.y = 0;
        p.vy = 0;
        p.vx = speed;
        p.wire = null;
        p.state = 'running';
      }
    }
  } else if (p.state === 'jumping' || !supported(p.x) || p.y > 0) {
    p.state = 'jumping';
    p.vx = p.vx === 0 ? speed : p.vx;
    p.vy = Math.max(p.vy - ph.gravity, -ph.maxFall);
    p.x += p.vx;
    p.y += p.vy;
    p.airTicks++;
    if (p.jumpBuffer > 0) p.jumpBuffer--;
    const pressed = jump && p.jumpHeldTicks === 1;
    if (pressed && !p.jumped && p.airTicks <= COYOTE_TICKS) { // coyote time: a late jump off the edge still jumps
      p.vy = ph.jumpVelocity;
      p.jumped = true;
      event('jump', {});
    } else if (pressed && !p.wire) { // a jump press in the air: fire the hook at the nearest anchor
      let best = null, bestD = Infinity;
      const headY = p.y + rules.player.height;
      for (const a of q.anchors) {
        const dx = a.x - p.x, dy = a.y - headY;
        if (dx < -ATTACH_BEHIND || dx > ph.wireRange || dy < ATTACH_MIN_RISE) continue; // up and forward
        const d = isqrt(dx * dx + dy * dy);
        if (d <= ph.wireRange && d < bestD) {
          best = a;
          bestD = d;
        }
      }
      if (best) {
        p.wire = { anchorId: best.id, anchorX: best.x, anchorY: best.y, length: Math.max(ph.wireMinLength, bestD) };
        p.state = 'swinging';
        p.height = rules.player.height;
        event('wire.attach', { anchor: best.id });
      } else p.jumpBuffer = JUMP_BUFFER_TICKS; // nothing to hook: remember the press for the landing
    }
    if (p.state === 'jumping' && p.y <= 0 && supported(p.x)) { // landed
      p.y = 0;
      p.vx = speed;
      p.airTicks = 0;
      p.jumped = false;
      if (p.jumpBuffer > 0) { // a buffered press: jump again at once
        p.vy = ph.jumpVelocity;
        p.jumpBuffer = 0;
        p.jumped = true;
        event('jump', {});
      } else {
        p.vy = 0;
        p.state = 'running';
      }
    }
  } else { // on the ground: running or sliding
    p.vx = speed;
    p.x += p.vx;
    p.y = 0;
    p.airTicks = 0;
    p.jumped = false;
    if (jump && p.jumpHeldTicks === 1 && !slide) {
      p.vy = ph.jumpVelocity;
      p.jumped = true;
      p.state = 'jumping';
      event('jump', {});
    } else p.state = slide ? 'sliding' : 'running';
  }
  p.height = p.state === 'sliding' ? rules.player.slideHeight : rules.player.height;

  // 3. collisions
  const half = Math.trunc(rules.player.width / 2);
  let died = '';
  // below the ground over a pit: Sepia fell in (a jumper over the pit is above y = 0)
  if (p.y < FALL_DEATH_Y || (p.y < -PIT_GRACE && p.state !== 'swinging' && !supported(p.x))) died = 'pit';
  else for (const o of q.obstacles) {
    if (o.kind === 'pit') continue;
    if (p.x + half > o.x && p.x - half < o.x + o.w && p.y < o.y + o.h && p.y + p.height > o.y) {
      died = 'obstacle';
      break;
    }
  }

  // 4. sections and the outcome
  const here = sectionAt(q.bounds, p.x);
  for (let i = 0; i < 6; i++) {
    if (p.x >= q.bounds[i].start) stat(`wave:${i + 1}:reached`).uses = 1;
    if (p.x >= q.bounds[i].end) {
      stat(`wave:${i + 1}:cleared`).uses = 1;
    }
    if (p.x >= q.bounds[i].start) stat(`wave:${i + 1}:cleared`).opportunities = 1;
  }
  void here;
  if (died) q.outcome = { status: 'draw', winners: [], reason: died };
  else if (p.x >= q.finishX) q.outcome = { status: 'win', winners: [SEAT], reason: 'finish' };
  else if (tick >= q.config.maxTicks) q.outcome = { status: 'draw', winners: [], reason: 'max_ticks' };
  q.statistics.durationTicks = tick;
  if (q.outcome.status !== 'running') {
    mine.wins = q.outcome.status === 'win' ? 1 : 0;
    mine.draws = q.outcome.status === 'draw' ? 1 : 0;
  }
  return { state: next, events, outcome: outcome(next), statisticsDelta: statisticsDelta(state.payload.statistics,
    q.statistics) };
}

export const adapter = { describe, initial, observe, legalActions, step, outcome, statistics, hash };
