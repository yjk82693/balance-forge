// scripted-0.2.2b: CANDIDATE variant of scripted-0.2.2 (not adopted). Same code and draws; the one difference is when a
// projectile-first hero holds back. 0.2.2 keeps such a hero 3,200-6,400 apart for the whole match, so every fight
// between two projectile users is a pure ranged duel and melee balance never shows. Here the hero still closes to
// melee range when
//   - the opponent is melee-first (its strongest attack move is a melee move), or
//   - its own melee is ready and the opponent is in recovery (a punish window).
// No hero ids: "melee-first" is read from the game data, the same way as in 0.2.2. The melee stand-off keeps the seat's
// seeded position (the same share of the range as its own draw), so no extra draws are made. A bot that has closed in
// does not walk back out, it only stops approaching, so there is no jitter.
import { data } from './index.js';
import { decide, MELEE_STANDOFF, reaches, standOffRange, strongestAttack } from './bot-0.2.2.js';
import { deriveBotSeed } from './bot.js';

export const botPolicyVersion = 'scripted-0.2.2b';
export { deriveBotSeed };

/** The seat's own stand-off drawn into the melee range: the same relative position inside the melee band. */
export function meleeStandOff(policy, heroId) {
  const [low, high] = standOffRange(heroId);
  const share = high > low ? (policy.distance - low) / (high - low) : 0;
  const melee = reaches().melee;
  const [mLow, mHigh] = MELEE_STANDOFF.map(x => Math.round(melee * x));
  return Math.round(mLow + share * (mHigh - mLow));
}

/** True when a projectile-first hero should close to melee range this tick. */
export function engages({ me, enemy, legal, view }) {
  const enemyMeleeFirst = strongestAttack(enemy.hero, data) === 'melee';
  const ownMeleeReady = legal.some(a => a.actionId === 'melee');
  const enemyRecovering = enemy.recoveryUntil > view.tick;
  return enemyMeleeFirst || (ownMeleeReady && enemyRecovering);
}

export const chooseActions = (view, seq, variant = 0) => decide(view, seq, variant, {
  standOff: context => strongestAttack(context.me.hero, data) === 'melee' || !engages(context) ?
    context.policy.distance : meleeStandOff(context.policy, context.me.hero)
});
