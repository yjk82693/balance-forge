import { deepFreeze } from '../../sim/index.js';
const credit = {
  authorKey: 'balance_forge',
  licenseKey: 'original_event'
};
const move = (id, archetype, power, weightTier, effects = []) => ({
  id,
  nameKey: `move.${id}`,
  archetype,
  power,
  weightTier,
  effects,
  ...credit
});
export const data = deepFreeze({
  v: 1,
  gameId: 'hero_arena',
  characters: [{
    id: 'bari',
    health: 540,
    speed: 120,
    moveIds: ['melee', 'spirit_arrow', 'guard']
  }, {
    id: 'real_armor',
    health: 700,
    speed: 85,
    moveIds: ['melee', 'projectile', 'guard']
  }, {
    id: 'daewi',
    health: 580,
    speed: 110,
    moveIds: ['heavy_melee', 'projectile', 'guard']
  }, {
    id: 'sepia',
    health: 480,
    speed: 150,
    moveIds: ['melee', 'projectile', 'guard']
  }, {
    id: 'nightcrow',
    health: 480,
    speed: 150,
    moveIds: ['crow_dive', 'crow_swarm', 'wing_shield']
  }].map(c => ({
    ...c,
    nameKey: `hero.${c.id}`,
    ...credit
  })),
  moves: [move('melee', 'melee', 38, 0), move('spirit_arrow', 'projectile', 92, 1), move('guard', 'guard', 0, 0, [{
    operator: 'shield',
    amount: 100,
    durationTicks: 20
  }]), move('projectile', 'projectile', 44, 1), move('heavy_melee', 'melee', 62, 2), move('crow_dive', 'melee', 38,
    0), move('crow_swarm', 'projectile', 44, 1), move('wing_shield', 'guard', 0, 0, [{
    operator: 'shield',
    amount: 100,
    durationTicks: 20
  }])],
  weightTiers: [{
    startupTicks: 3,
    recoveryTicks: 8,
    cooldownTicks: 18,
    stunTicks: 3,
    knockback: 120,
    hitStopTicks: 1
  }, {
    startupTicks: 6,
    recoveryTicks: 12,
    cooldownTicks: 32,
    stunTicks: 4,
    knockback: 160,
    hitStopTicks: 1
  }, {
    startupTicks: 10,
    recoveryTicks: 18,
    cooldownTicks: 40,
    stunTicks: 7,
    knockback: 260,
    hitStopTicks: 2
  }, {
    startupTicks: 15,
    recoveryTicks: 24,
    cooldownTicks: 55,
    stunTicks: 10,
    knockback: 360,
    hitStopTicks: 3
  }],
  tuning: {
    damageScalePermille: 1000
  },
  gameRules: {
    arena: {
      w: 16000,
      h: 9000
    },
    meleeRange: 1900,
    projectileSpeed: 460,
    projectileRadius: 450,
    projectileLife: 45,
    guardDuration: 20,
    moveTraits: [{
      moveId: 'spirit_arrow',
      ignoresGuard: true
    }, {
      moveId: 'projectile',
      ignoresGuard: false
    }]
  },
  provenance: [{
    ...credit,
    source: 'original-event-content',
    noticeKey: 'content.original'
  }]
});
