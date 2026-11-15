import type { GameData, TentacleRules } from '../../contracts/types.ts';
import { deepFreeze } from '../../sim/index.ts';

// Original event rules: the rooftop, a grid of anchor posts, five waves and the Man-Shark boss. Wave 4 is the designed
// flaw: four sentries that hit hard and fire fast, so almost no run gets past it until the numbers are tuned.
const posts = Array.from({ length: 15 }, (_, id) => ({ id, x: 2000 + 3000 * (id % 5),
  y: 1500 + 3000 * Math.floor(id / 5) }));
export const rules: TentacleRules = {
  arena: { w: 16000, h: 9000 },
  posts,
  player: { health: 100, speed: 70, latchRange: 7000, latchSpeed: 260, latchCooldownTicks: 90,
    latchInvulnerableTicks: 30, whipRange: 2200, whipDamage: 30, whipCooldownTicks: 20 },
  enemies: { walker: { health: 40 }, drone: { health: 30 }, sentry: { health: 60 } },
  waves: [
    { walkers: 3, drones: 0, sentries: 0, enemySpeed: 20, enemyDamage: 8, fireIntervalTicks: 120 },
    { walkers: 4, drones: 3, sentries: 0, enemySpeed: 24, enemyDamage: 9, fireIntervalTicks: 100 },
    { walkers: 5, drones: 3, sentries: 3, enemySpeed: 26, enemyDamage: 14, fireIntervalTicks: 90 },
    { walkers: 2, drones: 2, sentries: 5, enemySpeed: 26, enemyDamage: 40, fireIntervalTicks: 30,
      flaw: 'designed flaw: the sentries hit for 40 and fire every 30 ticks' },
    { walkers: 6, drones: 4, sentries: 3, enemySpeed: 30, enemyDamage: 12, fireIntervalTicks: 80 }
  ],
  boss: { health: 320, speed: 22, contactDamage: 15, shotDamage: 8, fireIntervalTicks: 80, phases: 3 },
  betweenWavesTicks: 60,
  healOnClear: 20
};
export const data: GameData = deepFreeze({
  v: 1,
  gameId: 'tentacle_run',
  characters: [],
  moves: [],
  weightTiers: Array.from({ length: 4 }, () => ({ startupTicks: 0, recoveryTicks: 0, cooldownTicks: 0, stunTicks: 0,
    knockback: 0, hitStopTicks: 0 })),
  tuning: { damageScalePermille: 1000 },
  gameRules: rules,
  provenance: [{ authorKey: 'balance_forge', licenseKey: 'original_event', source: 'original-event-content',
    noticeKey: 'content.original' }]
});
