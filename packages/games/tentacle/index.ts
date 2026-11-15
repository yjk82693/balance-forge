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
const CHASM_WIDTH = 3600; // a swing chasm: more than 1.5 x the longest jump (64 ticks at 30 units = 1920)
const CHASM_ANCHOR_BEFORE = 700; // the first anchor of a chasm chain stands this far before its near edge
const PIT_GRACE = 500; // how far below the ground over a pit before it is a fall (room for a coyote jump)
const SWING_MAX_SPEED = 40; // per axis, so a swing never gets too fast
const SWING_PUSH = 0; // forward push per tick while swinging (the pump)
const RELEASE_SPEED_PERMILLE = 1600; // on release Sepia flies at least this share of the run speed (x1.6)

export const describe = () => ({
  gameId: 'tentacle_run',
  titleKey: 'game.tentacle_run',
  mode: 'realtime',
  minPlayers: 1,
  maxPlayers: 2, // 2 = a versus match (two seats, one shared course)
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
    // Every second pit is a swing chasm: too wide to jump (more than 1.5 x the longest jump), with anchors over it.
    let pitCount = 0;
    const widths = kinds.map(kind => (kind === 'pit' ? (pitCount++ % 2 === 1 ? CHASM_WIDTH : rules.obstacles.pitWidth) :
      kind === 'lowBar' ? rules.obstacles.lowBarWidth : rules.obstacles.wallWidth));
    const free = section.length - SPAWN_LEAD - 3000 - widths.reduce((sum, w) => sum + w, 0);
    const gap = kinds.length ? Math.max(1500, Math.trunc(free / kinds.length)) : 0;
    let cursor = start + SPAWN_LEAD;
    kinds.forEach((kind, i) => {
      const x = cursor + roll(state, Math.max(1, Math.trunc(gap / 4)));
      const o = rules.obstacles, w = widths[i];
      // after a swing (a chasm or a wall) Sepia flies on before she lands: leave room before the next obstacle
      cursor = x + w + gap - Math.trunc(gap / 8) + (w === CHASM_WIDTH ? 2800 : kind === 'wall' ? 1800 : 0);
      if (kind === 'pit') {
        obstacles.push({ id: `o${obstacles.length}`, kind, x, w, y: 0, h: 0, section: n });
        if (w === CHASM_WIDTH) { // a chain of anchors over the chasm, starting just before its edge
          for (let ax = x - CHASM_ANCHOR_BEFORE; ax < x + w && ax < x - CHASM_ANCHOR_BEFORE + 3 * section.anchorSpacing;
            ax += section.anchorSpacing) {
            anchors.push({ id: `a${anchors.length}`, x: ax, y: o.anchorHeight, section: n, overPit: true });
          }
        }
      } else if (kind === 'lowBar') {
        obstacles.push({ id: `o${obstacles.length}`, kind, x, w, y: o.lowBarBottom, h: o.lowBarTop - o.lowBarBottom,
          section: n });
      } else { // a wall has its anchor before it (the further apart the anchors of the section, the further before)
        obstacles.push({ id: `o${obstacles.length}`, kind, x, w, y: 0, h: o.wallHeight, section: n });
        anchors.push({ id: `a${anchors.length}`, x: x - Math.trunc(section.anchorSpacing / 2), y: o.anchorHeight,
          section: n, overPit: false });
      }
    });
    start = end;
  });
  return { obstacles, anchors, bounds, finishX: start };
}

const PLAYER_FIELDS = ['x', 'y', 'vx', 'vy', 'state', 'height', 'jumpHeldTicks', 'airTicks', 'jumpBuffer', 'jumped',
  'wire'];
const newPlayer = (rules: TentacleRules) => ({ x: 0, y: 0, vx: rules.sections[0].runSpeed, vy: 0, state: 'running',
  height: rules.player.height, jumpHeldTicks: 0, airTicks: 0, jumpBuffer: 0, jumped: false, wire: null });
const playerOf = (runner: any) => Object.fromEntries(PLAYER_FIELDS.map(key => [key, structuredClone(runner[key])]));

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
      ...(config.players.length === 2 ? { // versus: one runner per seat, the same course
        runners: config.players.map(id => ({ id, ...newPlayer(rules), input: { jump: 0, slide: 0 }, alive: true }))
      } : { input: { jump: 0, slide: 0 }, player: newPlayer(rules) }),
      outcome: { status: 'running', winners: [], reason: 'in_progress' },
      statistics: emptyStatistics(config.players, config.players.length === 2 ?
        [...statNames(), 'distance', 'section'] : statNames())
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
  const p = state.payload, width = 16000;
  const versus = Array.isArray(p.runners);
  // the runner this view follows: the seat's own, or (display and others) the leader
  const leader = versus ? (p.runners[1].x > p.runners[0].x ? p.runners[1] : p.runners[0]) : null;
  const mine = versus ? (p.runners.find((r: any) => r.id === viewerId) ?? leader) : p.player;
  const you = versus && p.runners.some((r: any) => r.id === viewerId) ? viewerId : null;
  const cameraX = Math.max(0, mine.x - 4000);
  // the display shows both runners: its window reaches back to the one who is behind
  const lowX = versus && !you ? Math.min(...p.runners.map((r: any) => r.x)) - 1000 : cameraX - 1000;
  const near = (o: { x: number; w?: number }) => o.x + (o.w ?? 0) >= lowX && o.x <= cameraX + width + 1000;
  const index = sectionAt(p.bounds, mine.x);
  const runnerView = (r: any) => ({ id: r.id, x: r.x, y: r.y, vx: r.vx, vy: r.vy, state: r.state, height: r.height,
    wire: structuredClone(r.wire), alive: r.alive, section: sectionAt(p.bounds, r.x) + 1 });
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
      player: versus ? playerOf(mine) : structuredClone(p.player),
      obstacles: p.obstacles.filter(near).map(o => ({ ...o })),
      anchors: p.anchors.filter(near).map(a => ({ ...a })),
      shark: index === 5 ? { x: Math.max(0, mine.x - 5000) } : null,
      outcome: structuredClone(p.outcome),
      ...(versus ? { versus: { you,
        opponent: you ? (({ id, x, state: st, alive }) => ({ id, x, state: st, alive }))(p.runners.find((r: any) =>
          r.id !== you)) : null,
        runners: p.runners.map(runnerView), leader: leader.id } } : {})
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
  const seated = p.versus ? p.versus.you !== null : view.viewerId === SEAT;
  if (!seated || p.outcome.status !== 'running') return [];
  return [structuredClone(actions[0])];
}
export const outcome = (state: State): Outcome => structuredClone(state.payload.outcome);
export const statistics = (state: State): Statistics => structuredClone(state.payload.statistics);

/**
 * One runner for one tick: movement (running, jumping, sliding or swinging), then collisions. `p` is the runner's
 * player state, `input` its held control. Returns '' while alive, else the death reason ('pit' or 'obstacle').
 */
function advanceRunner(q: any, p: any, input: { jump: number; slide: number }, rules: TentacleRules, tick: number,
  event: (kind: string, payload: Record<string, any>) => unknown): string {
  const ph = rules.physics;
  const jump = input.jump === 1, slide = input.slide === 1;
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
      p.vx = Math.max(p.vx, Math.trunc(speed * RELEASE_SPEED_PERMILLE / 1000)); // the swing carries her forward
      p.vy += ph.releaseBoost;
      event('wire.release', {});
    } else {
      wire.length = Math.max(ph.wireMinLength, wire.length - ph.reelSpeed);
      p.vy -= ph.swingGravity;
      p.vx += SWING_PUSH;
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
    if (p.vx > speed && p.airTicks % 3 === 2) p.vx--; // the swing's extra speed fades out slowly in flight
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
  // slide held in the air tucks Sepia in (low enough for a low bar), so a long flight after a swing can still pass one
  p.height = p.state === 'sliding' || (slide && p.state === 'jumping') ? rules.player.slideHeight : rules.player.height;

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
  return died;
}

/**
 * A versus tick: both runners advance on the shared course and never interact. The first death ends the match (the
 * survivor wins); both dying on the same tick: the one further right wins, an exact tie is a draw. Reaching the finish
 * first wins; at the time limit the one further right wins (a tie is a draw).
 */
function stepVersus(state: State, next: State, frame: InputFrame, rules: TentacleRules, event: any, events: any[]) {
  const q = next.payload, tick = frame.tick;
  const stats = (id: string) => q.statistics.players.find(pl => pl.playerId === id);
  for (const a of frame.actions) {
    q.runners.find((r: any) => r.id === a.playerId).input = { jump: a.params.jump, slide: a.params.slide };
    const control = stats(a.playerId).actions.find(x => x.actionId === 'control');
    control.uses++;
    control.opportunities++;
  }
  const died: Array<[any, string]> = [];
  for (const r of q.runners) {
    if (!r.alive) continue;
    const reason = advanceRunner(q, r, r.input, rules, tick, event);
    if (reason) {
      r.alive = false;
      died.push([r, reason]);
      event('runner.down', { id: r.id, reason });
    }
  }
  for (const r of q.runners) {
    const own = stats(r.id).actions, stat = (id: string) => own.find(x => x.actionId === id);
    for (let i = 0; i < 6; i++) {
      if (r.x >= q.bounds[i].start) {
        stat(`wave:${i + 1}:reached`).uses = 1;
        stat(`wave:${i + 1}:cleared`).opportunities = 1;
      }
      if (r.x >= q.bounds[i].end) stat(`wave:${i + 1}:cleared`).uses = 1;
    }
    stat('distance').uses = Math.max(0, Math.trunc(r.x));
    stat('section').uses = sectionAt(q.bounds, r.x) + 1;
  }
  const [a, b] = q.runners;
  const further = a.x === b.x ? null : a.x > b.x ? a : b; // null on an exact tie
  const decide = (winner: any, reason: string) => ({ status: 'win', winners: [winner.id], reason });
  if (died.length === 2) {
    q.outcome = further ? decide(further, 'opponent_down') : { status: 'draw', winners: [], reason: 'draw' };
  } else if (died.length === 1) {
    q.outcome = decide(q.runners.find((r: any) => r.alive), 'opponent_down');
  } else if (q.runners.some((r: any) => r.x >= q.finishX)) {
    const finishers = q.runners.filter((r: any) => r.x >= q.finishX);
    q.outcome = decide(finishers.length === 2 ? (further ?? a) : finishers[0], 'finish');
  } else if (tick >= q.config.maxTicks) {
    q.outcome = further ? decide(further, 'max_ticks') : { status: 'draw', winners: [], reason: 'draw' };
  }
  q.statistics.durationTicks = tick;
  if (q.outcome.status !== 'running') {
    for (const pl of q.statistics.players) {
      pl.wins = q.outcome.winners.includes(pl.playerId) ? 1 : 0;
      pl.draws = q.outcome.status === 'draw' ? 1 : 0;
    }
  }
  return { state: next, events, outcome: outcome(next), statisticsDelta: statisticsDelta(state.payload.statistics,
    q.statistics) };
}

export function step(state: State, frame: InputFrame, data: GameData): StepResult {
  assertPinned(state, data);
  if (state.payload.outcome.status !== 'running') throw Error('ILLEGAL_ACTION');
  const rules = data.gameRules as TentacleRules;
  const players = state.payload.config.players;
  validateFrame(state, frame, players, actions, a => players.includes(a.playerId), true);
  if (frame.systemInputs.length) throw Error('ILLEGAL_ACTION');
  const next = structuredClone(state), q = next.payload, tick = frame.tick;
  next.tick = tick;
  const events: StepResult['events'] = [];
  const event = (kind: string, payload: Record<string, any>) => events.push({ eventId: `${tick}:${events.length}`,
    audience: [], kind, payload });
  if (Array.isArray(q.runners)) return stepVersus(state, next, frame, rules, event, events);
  const mine = q.statistics.players[0];
  const stat = (id: string) => mine.actions.find(a => a.actionId === id);
  const p = q.player;

  // 1. the control input (the last one stays until a new one arrives)
  for (const a of frame.actions) {
    q.input = { jump: a.params.jump, slide: a.params.slide };
    stat('control').uses++;
    stat('control').opportunities++;
  }
  let died = advanceRunner(q, p, q.input, rules, tick, event);

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
