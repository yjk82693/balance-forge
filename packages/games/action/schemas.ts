import { integer as int, text, array, object, ref } from '../../contracts/shapes.ts';
const hero = {
  enum: ['bari', 'real_armor', 'daewi', 'sepia', 'nightcrow']
};
export const axes = {
  moveX: int(-1000, 1000),
  moveY: int(-1000, 1000)
};
export const actions = ['melee', 'projectile', 'guard', 'move'].map(actionId => ({
  actionId,
  labelKey: `action.${actionId}`,
  control: actionId === 'move' ? 'axes' : 'button',
  paramsSchema: object(actionId === 'move' ? axes : {
    aimX: int(-1000, 1000),
    aimY: int(-1000, 1000)
  })
}));
const outcome = ref('Outcome'),
  stats = ref('Statistics');
const pending = object({
  actionId: {
    enum: ['', 'melee', 'projectile', 'guard']
  },
  due: int(),
  aimX: int(-1000, 1000),
  aimY: int(-1000, 1000)
});
export const entity = object({
  id: text(),
  hero,
  x: int(0, 16000),
  y: int(0, 9000),
  hp: int(0, 1000000),
  maxHp: int(1, 1000000),
  facing: {
    enum: [0, 180]
  },
  cooldowns: array(int(), 3, 3),
  guardUntil: int(),
  shield: int(0, 1000000),
  stunUntil: int(),
  recoveryUntil: int(),
  lastSeq: int(-1),
  pending
});
export const projectile = object({
  id: text(),
  owner: text(),
  kind: text(),
  x: int(-100000, 100000),
  y: int(-100000, 100000),
  vx: int(-10000, 10000),
  vy: int(-10000, 10000),
  life: int(0, 10000),
  power: int(0, 10000),
  moveId: text(),
  ignoresGuard: {
    type: 'boolean'
  }
});
export const schemas = {
  ...Object.fromEntries(actions.map(a => [`action:${a.actionId}`, a.paramsSchema])),
  rules: object({
    arena: object({
      w: {
        const: 16000
      },
      h: {
        const: 9000
      }
    }),
    meleeRange: int(1, 16000),
    projectileSpeed: int(1, 10000),
    projectileRadius: int(1, 16000),
    projectileLife: int(1, 10000),
    guardDuration: int(1, 10000),
    moveTraits: array(object({
      moveId: text(),
      ignoresGuard: {
        type: 'boolean'
      }
    }), 32)
  }),
  state: object({
    config: ref('MatchConfig'),
    entities: array(entity, 2, 2),
    projectiles: array(projectile, 128),
    nextProjectile: int(),
    hitStop: int(0, 10000),
    outcome,
    statistics: stats
  }),
  observation: object({
    arena: object({
      w: {
        const: 16000
      },
      h: {
        const: 9000
      }
    }),
    entities: array(entity, 2, 2),
    projectiles: array(projectile, 128),
    outcome,
    hitStop: int(0, 10000)
  })
};
