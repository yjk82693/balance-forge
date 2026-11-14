import { data, legalActions } from './index.js';
export const botPolicyVersion = 'scripted-0.2.0';
// Predict discrete projectile positions without consulting guard-bypass traits or hero identities.
function incomingProjectile(view, hero) {
  const character = data.characters.find(character => character.id === hero.hero);
  const guard = data.moves.find(move => character.moveIds.includes(move.id) && move.archetype === 'guard');
  const horizon = data.weightTiers[guard.weightTier].startupTicks + 4;
  return view.payload.projectiles.some(shot => {
    if (shot.owner === hero.id) return false;
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
  const dx = enemy.x - me.x,
    dy = enemy.y - me.y,
    close = dx * dx + dy * dy <= 1800 ** 2;
  const preference = close ? ['melee', 'projectile', 'guard', 'move'] : variant % 3 === 1 && view.tick % 120 < 55 ? [
    'guard', 'projectile', 'melee', 'move'] : ['projectile', 'guard', 'melee', 'move'];
  const actionId = legal.some(action => action.actionId === 'guard') && incomingProjectile(view, me) ?
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
      moveY: Math.sign(dy) * 1000
    }
  }] : [];
  if (actionId === 'move') return movement;
  const params = {
    aimX: Math.trunc(dx * 1000 / norm) || 0,
    aimY: Math.trunc(dy * 1000 / norm) || 0
  };
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
