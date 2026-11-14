// scripted-0.2.2: CANDIDATE bot policy. Not adopted: the runner, the room and the recorded files still use bot.js
// (scripted-0.2.1). Adopting it changes every recorded number, so that is a decision for the integrator.
//
// What changes against 0.2.1 (everything else is the same code and the same seeded draws):
//   1. The seeded stand-off distance is drawn from the hero's own reach. A hero whose strongest attack is a melee
//      move closes to 60-95% of the melee range; a hero whose strongest attack is a projectile stays at 20-40% of
//      the projectile range (capped by the arena width). "Strongest" is read from the hero's moves in the game data,
//      never from a hero id, so there are no hero branches. 0.2.1 drew 1200-3600 for everyone, which left melee
//      heroes standing outside their own reach and swinging at nothing.
//   2. A melee swing is never started when the target is outside the melee range. Projectiles are unchanged.
// Still seeded per seat with deriveBotSeed (re-exported unchanged); no draws touch the simulation RNG.
import { data, legalActions } from './index.js';
import { xorshift32 } from '../../sim/index.js';
import { deriveBotSeed } from './bot.js';

export const botPolicyVersion = 'scripted-0.2.2';
export { deriveBotSeed };

export const MELEE_STANDOFF = [0.6, 0.95]; // share of the melee range
const PROJECTILE_STANDOFF = [0.2, 0.4]; // share of the projectile range
const ATTACKS = ['melee', 'projectile'];

/** Melee range and the distance a projectile can fly (speed x life), the latter capped by the arena width. */
export function reaches(gameData = data) {
  const rules = gameData.gameRules;
  return { melee: rules.meleeRange, projectile: Math.min(rules.projectileSpeed * rules.projectileLife, rules.arena.w) };
}

/** The attack archetype of a hero's strongest move (ties: melee). Read from the data, not from the hero id. */
export function strongestAttack(heroId, gameData = data) {
  const character = gameData.characters.find((c) => c.id === heroId);
  const moves = gameData.moves.filter((m) => character?.moveIds.includes(m.id) && ATTACKS.includes(m.archetype));
  const best = [...moves].sort((a, b) => b.power - a.power || (a.archetype === 'melee' ? -1 : 1))[0];
  return best?.archetype ?? 'melee';
}

/** The [low, high] stand-off distance (whole units) a hero may draw from. */
export function standOffRange(heroId, gameData = data) {
  const reach = reaches(gameData);
  const [share, kind] = strongestAttack(heroId, gameData) === 'melee' ? [MELEE_STANDOFF, 'melee']
    : [PROJECTILE_STANDOFF, 'projectile'];
  return [Math.round(reach[kind] * share[0]), Math.round(reach[kind] * share[1])];
}

export function profile(seed, heroId) {
  let rng = (seed >>> 0) || 1;
  const draw = maximum => {
    rng = xorshift32(rng);
    return rng % maximum;
  };
  const [low, high] = standOffRange(heroId);
  return {
    reaction: draw(13), guardChance: 55 + draw(41), distance: low + draw(high - low + 1),
    strafe: draw(2) ? 1 : -1, aimX: draw(321) - 160, aimY: draw(321) - 160, rng
  };
}
// Unchanged from 0.2.1: each projectile owns a fixed draw from the same stream.
export function attemptsGuard(shot, policy) {
  let rng = policy.rng;
  const index = Number(shot.id.replace(/^pr/, ''));
  for (let i = 0; i < index; i++) rng = xorshift32(rng);
  return rng % 100 < policy.guardChance;
}
export function incomingProjectile(view, hero, policy) {
  const character = data.characters.find(character => character.id === hero.hero);
  const guard = data.moves.find(move => character.moveIds.includes(move.id) && move.archetype === 'guard');
  const horizon = data.weightTiers[guard.weightTier].startupTicks + 4 + 12 - policy.reaction;
  return view.payload.projectiles.some(shot => {
    if (shot.owner === hero.id || !attemptsGuard(shot, policy)) return false;
    for (let tick = 1; tick <= Math.min(horizon, shot.life); tick++) {
      const dx = shot.x + shot.vx * tick - hero.x;
      const dy = shot.y + shot.vy * tick - hero.y;
      if (dx * dx + dy * dy <= data.gameRules.projectileRadius ** 2) return true;
    }
    return false;
  });
}
/**
 * The decision, shared with scripted-0.2.2b. `options.standOff(context)` may replace the stand-off distance of this
 * tick (0.2.2 keeps the seeded one); it gets { me, enemy, legal, policy, view } and returns a distance in whole units.
 */
export function decide(view, seq, variant, options = {}) {
  const legal = legalActions(view),
    me = view.payload.entities.find(e => e.id === view.viewerId),
    enemy = view.payload.entities.find(e => e.id !== view.viewerId);
  if (!legal.length || !enemy) return [];
  const policy = profile(variant, me.hero);
  const standOff = options.standOff ? options.standOff({ me, enemy, legal, policy, view }) : policy.distance;
  const dx = enemy.x - me.x,
    dy = enemy.y - me.y,
    close = dx * dx + dy * dy <= standOff ** 2,
    inMeleeReach = dx * dx + dy * dy <= data.gameRules.meleeRange ** 2;
  const preference = close ? ['melee', 'projectile', 'guard', 'move'] : variant % 3 === 1 && view.tick % 120 < 55 ? [
    'guard', 'projectile', 'melee', 'move'] : ['projectile', 'guard', 'melee', 'move'];
  // Change 2: a melee swing needs a target inside the melee range.
  const usable = id => legal.some(a => a.actionId === id) && (id !== 'melee' || inMeleeReach);
  const actionId = legal.some(action => action.actionId === 'guard') && incomingProjectile(view, me, policy) ?
    'guard' : preference.find(usable);
  if (!actionId) return [];
  const norm = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const movement = legal.some(a => a.actionId === 'move') ? [{
    playerId: view.viewerId,
    seq,
    tick: view.tick + 1,
    turnId: 0,
    actionId: 'move',
    params: {
      moveX: close ? 0 : Math.sign(dx) * 1000,
      moveY: close ? (me.y < 1000 ? 1 : me.y > 8000 ? -1 : policy.strafe) * 1000 :
        Math.sign(dy) * 1000
    }
  }] : [];
  if (actionId === 'move') return movement;
  const params = {
    aimX: Math.trunc(dx * 1000 / norm) || 0,
    aimY: Math.trunc(dy * 1000 / norm) || 0
  };
  if (actionId === 'projectile') {
    params.aimX = Math.max(-1000, Math.min(1000, params.aimX + policy.aimX));
    params.aimY = Math.max(-1000, Math.min(1000, params.aimY + policy.aimY));
  }
  if (actionId === 'projectile' && !params.aimX && !params.aimY) params.aimX = 1000;
  return [...movement, {
    playerId: view.viewerId,
    seq: seq + 1,
    tick: view.tick + 1,
    turnId: 0,
    actionId,
    params
  }];
}

export const chooseActions = (view, seq, variant = 0) => decide(view, seq, variant);
