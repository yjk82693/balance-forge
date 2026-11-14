import { data, legalActions } from './index.js';
export const botPolicyVersion = 'scripted-0.2.1';
import { xorshift32 } from '../../sim/index.js';

// Stable public boundary: callers derive once per match and pass the result as variant on every tick.
export function deriveBotSeed(matchSeed, seatIndex) {
  if (!Number.isInteger(matchSeed) || matchSeed < 1 || matchSeed > 0xffffffff ||
      !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 63) throw Error('INVALID_SCHEMA');
  return xorshift32(((matchSeed ^ Math.imul(seatIndex + 1, 0x9e3779b9)) >>> 0) || 1);
}
function profile(seed) {
  let rng = (seed >>> 0) || 1;
  const draw = maximum => {
    rng = xorshift32(rng);
    return rng % maximum;
  };
  return {
    reaction: draw(13), guardChance: 55 + draw(41), distance: 1200 + draw(2401),
    strafe: draw(2) ? 1 : -1, aimX: draw(321) - 160, aimY: draw(321) - 160, rng
  };
}
// Each projectile owns a fixed draw from the same stream, independent of observation/caller frequency.
function attemptsGuard(shot, policy) {
  let rng = policy.rng;
  const index = Number(shot.id.replace(/^pr/, ''));
  for (let i = 0; i < index; i++) rng = xorshift32(rng);
  return rng % 100 < policy.guardChance;
}
function incomingProjectile(view, hero, policy) {
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
export function chooseActions(view, seq, variant = 0) {
  const legal = legalActions(view),
    me = view.payload.entities.find(e => e.id === view.viewerId),
    enemy = view.payload.entities.find(e => e.id !== view.viewerId);
  if (!legal.length || !enemy) return [];
  const policy = profile(variant);
  const dx = enemy.x - me.x,
    dy = enemy.y - me.y,
    close = dx * dx + dy * dy <= policy.distance ** 2;
  const preference = close ? ['melee', 'projectile', 'guard', 'move'] : variant % 3 === 1 && view.tick % 120 < 55 ? [
    'guard', 'projectile', 'melee', 'move'] : ['projectile', 'guard', 'melee', 'move'];
  const actionId = legal.some(action => action.actionId === 'guard') && incomingProjectile(view, me, policy) ?
    'guard' : preference.find(id => legal.some(a => a.actionId === id));
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

/** @deprecated for old callers. Use chooseActions to include movement alongside a legal attack. */
export function chooseAction(view, seq, variant = 0) {
  return chooseActions(view, seq, variant).find(input => input.actionId !== 'move') ?? null;
}
