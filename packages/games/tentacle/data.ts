import type { GameData, TentacleRules } from '../../contracts/types.ts';
import { deepFreeze } from '../../sim/index.ts';

// Original event rules: a side-scrolling course of six sections with pits, low bars, walls and overhead anchor posts.
// Section 4 is the designed flaw: three walls and anchors 6,000 units apart, so the wire almost never reaches one.
export const rules: TentacleRules = {
  viewWidth: 16000,
  leadIn: 2000,
  player: { width: 600, height: 1200, slideHeight: 500 },
  physics: { gravity: 2, jumpVelocity: 64, maxFall: 60, tapTicks: 12, wireRange: 5200, wireMinLength: 2600,
    swingGravity: 2, reelSpeed: 30, releaseBoost: 14 },
  obstacles: { pitWidth: 1400, lowBarWidth: 900, lowBarBottom: 700, lowBarTop: 1500, wallWidth: 500, wallHeight: 1500,
    anchorHeight: 4500 },
  sections: [
    { length: 30000, pits: 2, lowBars: 1, walls: 0, anchorSpacing: 4000, runSpeed: 30 },
    { length: 30000, pits: 2, lowBars: 2, walls: 1, anchorSpacing: 4000, runSpeed: 30 },
    { length: 30000, pits: 3, lowBars: 2, walls: 1, anchorSpacing: 4500, runSpeed: 32 },
    { length: 30000, pits: 2, lowBars: 1, walls: 3, anchorSpacing: 6000, runSpeed: 32,
      flaw: 'designed flaw: three walls and anchors 6,000 units apart, out of reach of the wire' },
    { length: 30000, pits: 3, lowBars: 3, walls: 2, anchorSpacing: 4500, runSpeed: 34 },
    { length: 30000, pits: 3, lowBars: 3, walls: 2, anchorSpacing: 4500, runSpeed: 36 }
  ]
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
