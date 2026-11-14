// Learned bot policy (learned-cem-1): the scripted bot's decision structure with a small per-hero parameter
// vector that the trainer searches. It reads only the observation (inputs), never simulation state, draws nothing
// from the simulation RNG, and keeps no memory between calls, so determinism holds. A parameter vector is a
// validated record: every field has an integer range, and a field outside its range falls back to the parent's
// value, so a bad proposal (from a search, a model or a file) cannot crash a run.
import { data, legalActions } from './index.js';
import { xorshift32 } from '../../sim/index.js';
import { hash } from '../../contracts/index.js';
import * as scripted from './bot.js';

export const POLICY_ID = 'learned-cem-1';

/** The searchable parameters: integer ranges. `standOff` is the distance it holds, in arena units. */
export const PARAM_SPECS = Object.freeze({
  standOff: { min: 600, max: 6000, note: 'distance at which it stops closing in' },
  reaction: { min: 0, max: 12, note: 'ticks of reaction delay before a guard (higher = later)' },
  guardChance: { min: 0, max: 100, note: 'percent of incoming projectiles it tries to guard' },
  meleeClose: { min: 0, max: 2400, note: 'it swings melee only inside this distance' },
  aggression: { min: 0, max: 100, note: 'percent of ticks it attacks when an attack is legal' },
  aimBias: { min: -320, max: 320, note: 'projectile aim offset sideways of the aim line (a lead stand-in)' },
  strafePeriod: { min: 8, max: 120, note: 'ticks between strafe direction flips' },
});
export const PARAM_NAMES = Object.freeze(Object.keys(PARAM_SPECS));

/** Roughly the scripted bot's average behaviour: the starting point of a search. */
export const DEFAULT_PARAMS = Object.freeze({ standOff: 2400, reaction: 6, guardChance: 75, meleeClose: 1900,
  aggression: 90, aimBias: 0, strafePeriod: 40 });

const isValue = (name, value) => Number.isInteger(value) && value >= PARAM_SPECS[name].min &&
  value <= PARAM_SPECS[name].max;

/** Strict: throws on an unknown key, a missing key, a non-integer or an out-of-range value. */
export function validateParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('INVALID_SCHEMA');
  for (const key of Object.keys(params)) if (!PARAM_NAMES.includes(key)) throw Error('INVALID_SCHEMA');
  for (const name of PARAM_NAMES) if (!isValue(name, params[name])) throw Error('INVALID_SCHEMA');
  return params;
}

/**
 * Lenient: keeps every valid field of `candidate`, takes the parent's value for the rest, drops unknown keys.
 * Returns { params, fellBack: [names] }.
 */
export function sanitizeParams(candidate, parent = DEFAULT_PARAMS) {
  const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const params = {};
  const fellBack = [];
  for (const name of PARAM_NAMES) {
    if (isValue(name, source[name])) params[name] = source[name];
    else {
      params[name] = parent[name];
      fellBack.push(name);
    }
  }
  return { params, fellBack };
}

/** Hash of every hero's parameters, independent of key order; its first 8 hex digits tag the bot version. */
export function paramsHash(paramsByHero) {
  const sorted = Object.fromEntries(Object.keys(paramsByHero).sort().map(hero => [hero,
    Object.fromEntries(PARAM_NAMES.map(name => [name, paramsByHero[hero][name]]))]));
  return hash(sorted);
}
export const policyVersion = paramsByHero => `${POLICY_ID}+${paramsHash(paramsByHero).slice(0, 8)}`;

/** A pseudo-random percent for (seat seed, tick): a function of the inputs only, no state. */
const roll = (variant, tick, salt) => xorshift32(((variant ^ Math.imul(tick + 1, 0x9e3779b9) ^ salt) >>> 0) || 1) % 100;

function attemptsGuard(shot, variant, params) {
  let rng = ((variant ^ 0x5bd1e995) >>> 0) || 1;
  const index = Number(shot.id.replace(/^pr/, ''));
  for (let i = 0; i <= index; i++) rng = xorshift32(rng);
  return rng % 100 < params.guardChance;
}
function incomingProjectile(view, hero, variant, params) {
  const character = data.characters.find(c => c.id === hero.hero);
  const guard = data.moves.find(m => character.moveIds.includes(m.id) && m.archetype === 'guard');
  const horizon = data.weightTiers[guard.weightTier].startupTicks + 4 + 12 - params.reaction;
  return view.payload.projectiles.some(shot => {
    if (shot.owner === hero.id || !attemptsGuard(shot, variant, params)) return false;
    for (let tick = 1; tick <= Math.min(horizon, shot.life); tick++) {
      const dx = shot.x + shot.vx * tick - hero.x, dy = shot.y + shot.vy * tick - hero.y;
      if (dx * dx + dy * dy <= data.gameRules.projectileRadius ** 2) return true;
    }
    return false;
  });
}

/** The decision for one seat and tick with the given validated parameters. */
export function decideWith(params, view, seq, variant = 0) {
  const legal = legalActions(view),
    me = view.payload.entities.find(e => e.id === view.viewerId),
    enemy = view.payload.entities.find(e => e.id !== view.viewerId);
  if (!legal.length || !enemy) return [];
  const dx = enemy.x - me.x, dy = enemy.y - me.y, dist2 = dx * dx + dy * dy;
  const close = dist2 <= params.standOff ** 2;
  const canMelee = dist2 <= params.meleeClose ** 2;
  const attacking = roll(variant, view.tick, 0xa5a5a5a5) < params.aggression;
  const order = close ? ['melee', 'projectile', 'guard', 'move'] : ['projectile', 'guard', 'melee', 'move'];
  const usable = id => legal.some(a => a.actionId === id) && (id !== 'melee' || canMelee) &&
    (attacking || (id !== 'melee' && id !== 'projectile'));
  const actionId = legal.some(a => a.actionId === 'guard') && incomingProjectile(view, me, variant, params) ?
    'guard' : order.find(usable);
  if (!actionId) return [];
  const norm = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const phase = Math.floor(view.tick / params.strafePeriod) + (variant & 1);
  const strafe = phase % 2 ? 1 : -1;
  const movement = legal.some(a => a.actionId === 'move') ? [{
    playerId: view.viewerId, seq, tick: view.tick + 1, turnId: 0, actionId: 'move',
    params: {
      moveX: close ? 0 : Math.sign(dx) * 1000,
      moveY: close ? (me.y < 1000 ? 1 : me.y > 8000 ? -1 : strafe) * 1000 : Math.sign(dy) * 1000
    }
  }] : [];
  if (actionId === 'move') return movement;
  const aim = { aimX: Math.trunc(dx * 1000 / norm) || 0, aimY: Math.trunc(dy * 1000 / norm) || 0 };
  if (actionId === 'projectile') {
    // A sideways offset: perpendicular to the aim line, scaled by the bias (a stand-in for leading a moving target).
    const { aimX, aimY } = aim;
    aim.aimX = Math.max(-1000, Math.min(1000, aimX + Math.trunc(-aimY * params.aimBias / 1000)));
    aim.aimY = Math.max(-1000, Math.min(1000, aimY + Math.trunc(aimX * params.aimBias / 1000)));
    if (!aim.aimX && !aim.aimY) aim.aimX = 1000;
  }
  return [...movement, { playerId: view.viewerId, seq: seq + 1, tick: view.tick + 1, turnId: 0, actionId,
    params: aim }];
}

/**
 * chooseActions(view, seq, variant) for a whole roster: each hero uses its own learned parameters; a hero without any
 * uses the scripted 0.2.1 policy, so a partly trained roster still plays.
 */
export function makeLearnedBot(paramsByHero) {
  for (const params of Object.values(paramsByHero)) validateParams(params);
  const version = policyVersion(paramsByHero);
  const chooseActions = (view, seq, variant = 0) => {
    const me = view.payload.entities.find(e => e.id === view.viewerId);
    const params = me && paramsByHero[me.hero];
    return params ? decideWith(params, view, seq, variant) : scripted.chooseActions(view, seq, variant);
  };
  return { chooseActions, deriveBotSeed: scripted.deriveBotSeed, botPolicyVersion: version };
}
