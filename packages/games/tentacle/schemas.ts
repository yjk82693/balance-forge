import { integer as int, text, array, object, ref } from '../../contracts/shapes.ts';

const coord = int(-100000, 100000);
const axes = { moveX: int(-1000, 1000), moveY: int(-1000, 1000) };
const aim = { aimX: int(-1000, 1000), aimY: int(-1000, 1000) };
export const actions = [
  { actionId: 'move', labelKey: 'action.move', control: 'axes', paramsSchema: object(axes) },
  { actionId: 'latch', labelKey: 'action.latch', control: 'button', paramsSchema: object(aim) },
  { actionId: 'whip', labelKey: 'action.whip', control: 'button', paramsSchema: object(aim) }
];
const post = object({ id: int(0, 63), x: int(0, 16000), y: int(0, 9000) });
const wave = object({
  walkers: int(0, 30), drones: int(0, 30), sentries: int(0, 8), enemySpeed: int(1, 200), enemyDamage: int(1, 100),
  fireIntervalTicks: int(1, 600), flaw: text(200)
}, ['walkers', 'drones', 'sentries', 'enemySpeed', 'enemyDamage', 'fireIntervalTicks']);
const kind = { enum: ['player', 'walker', 'drone', 'sentry', 'boss'] };
const latch = { anyOf: [{ type: 'null' }, object({ post: int(0, 63), untilTick: int() })] };
const entityView = object({
  id: text(), kind, x: coord, y: coord, hp: int(0, 100000), maxHp: int(1, 100000), facingX: int(-1000, 1000),
  facingY: int(-1000, 1000), latch, latchReadyTick: int(), whipReadyTick: int(), invulnerableUntilTick: int(),
  whipUntilTick: int()
});
const projectile = object({ id: text(), x: coord, y: coord, vx: int(-1000, 1000), vy: int(-1000, 1000),
  life: int(0, 10000), damage: int(0, 1000), from: { enum: ['drone', 'sentry', 'boss'] } });
const boss = { anyOf: [{ type: 'null' }, object({ hp: int(0, 100000), maxHp: int(1, 100000), phase: int(0, 7),
  phases: int(1, 8) })] };
export const schemas = {
  ...Object.fromEntries(actions.map(a => [`action:${a.actionId}`, a.paramsSchema])),
  rules: object({
    arena: object({ w: { const: 16000 }, h: { const: 9000 } }),
    posts: array(post, 64, 1),
    player: object({ health: int(1, 1000), speed: int(1, 1000), latchRange: int(1, 20000), latchSpeed: int(1, 2000),
      latchCooldownTicks: int(0, 1000), latchInvulnerableTicks: int(0, 600), whipRange: int(1, 10000),
      whipDamage: int(1, 1000), whipCooldownTicks: int(0, 1000) }),
    enemies: object({ walker: object({ health: int(1, 1000) }), drone: object({ health: int(1, 1000) }),
      sentry: object({ health: int(1, 1000) }) }),
    waves: array(wave, 5, 5),
    boss: object({ health: int(1, 100000), speed: int(1, 200), contactDamage: int(0, 100), shotDamage: int(0, 100),
      fireIntervalTicks: int(1, 600), phases: int(1, 8) }),
    betweenWavesTicks: int(0, 600),
    healOnClear: int(0, 1000)
  }),
  state: object({
    config: ref('MatchConfig'),
    wave: int(1, 6),
    fighting: { type: 'boolean' },
    waveTick: int(),
    nextWaveTick: int(),
    nextId: int(),
    posts: array(post, 64, 1),
    bossPhases: int(1, 8),
    player: entityView,
    enemies: array(object({ id: text(), kind, x: coord, y: coord, hp: int(0, 100000), maxHp: int(1, 100000),
      facingX: int(-1000, 1000), facingY: int(-1000, 1000), nextFireTick: int(), nextHitTick: int() }), 64),
    projectiles: array(projectile, 256),
    outcome: ref('Outcome'),
    statistics: ref('Statistics')
  }),
  observation: object({
    wave: int(1, 6),
    waveCount: { const: 5 },
    waveTick: int(),
    breakTicks: int(),
    entities: array(entityView, 65, 1),
    posts: array(post, 64, 1),
    projectiles: array(projectile, 256),
    boss,
    outcome: ref('Outcome')
  })
};
