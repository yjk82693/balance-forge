// Policy cloned-lr-1: a Hero Arena bot that plays like the people whose matches it was fitted to (a hand-written
// multinomial logistic regression, see services/runner/learn/clone.ts and services/runner/learned/human-style.json).
// It reads inputs only: the observation in, ActionInputs out. Deterministic given the model file, the match seed
// and the tick: the class is SAMPLED from the model's probabilities with a roll derived from (variant, tick), so two
// runs with the same seed play the same match, and a different seed plays differently. mode "argmax" always takes
// the most likely class (ties go to the lower class index).
// It describes a few players in a few matches. It is a style, not a balance reference: never use it in a balance
// number.
import { data, legalActions } from './index.ts';
import { compareIds } from '../../contracts/index.ts';
import { xorshift32 } from '../../sim/index.ts';
import { deriveBotSeed } from './bot.ts';

export const CLONE_POLICY = 'cloned-lr-1';
export const ATTACKS = ['none', 'melee', 'projectile', 'guard'];
export const MOVES = ['still', 'toward', 'away', 'up', 'down'];
export const CLASSES = ATTACKS.flatMap(attack => MOVES.map(move => `${attack}/${move}`));
export const FEATURE_NAMES = ['bias', 'distance', 'cosToEnemy', 'sinToEnemy', 'ownMeleeReady', 'ownProjectileReady',
  'ownGuardReady', 'ownBusy', 'enemyBusy', 'enemyMeleeReady', 'ownHp', 'enemyHp', 'incomingProjectile',
  'enemyGuarding'];

const ARENA = { w: 16000, h: 9000 };
const clamp01 = x => Math.max(0, Math.min(1, x));

/** The feature vector for one seat from an observation (inputs only); null for a viewer without a seat. */
export function extractFeatures(view) {
  const me = view.payload.entities.find(e => e.id === view.viewerId);
  const enemy = view.payload.entities.find(e => e.id !== view.viewerId);
  if (!me || !enemy) return null;
  const dx = enemy.x - me.x, dy = enemy.y - me.y, dist = Math.hypot(dx, dy) || 1;
  const ready = (entity, index) => (entity.cooldowns[index] <= view.tick + 1 ? 1 : 0);
  const busy = entity => (entity.recoveryUntil > view.tick || entity.stunUntil > view.tick ||
    entity.pending.actionId ? 1 : 0);
  // time to the nearest incoming shot that will hit: 1 = about to land, 0 = none on its way
  let arrival = 0;
  for (const shot of view.payload.projectiles) {
    if (shot.owner === me.id) continue;
    for (let t = 1; t <= shot.life; t++) {
      const px = shot.x + shot.vx * t - me.x, py = shot.y + shot.vy * t - me.y;
      if (px * px + py * py <= data.gameRules.projectileRadius ** 2) {
        arrival = Math.max(arrival, 1 - t / shot.life);
        break;
      }
    }
  }
  return [1, clamp01(dist / Math.hypot(ARENA.w, ARENA.h)), dx / dist, dy / dist, ready(me, 0), ready(me, 1),
    ready(me, 2), busy(me), busy(enemy), ready(enemy, 0), me.hp / me.maxHp, enemy.hp / enemy.maxHp, arrival,
    enemy.guardUntil > view.tick ? 1 : 0];
}

const scoresOf = (weights, x) => weights.map(row => row.reduce((s, w, i) => s + w * x[i], 0));
export const probabilities = (weights, x) => {
  const scores = scoresOf(weights, x), top = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - top)), total = exps.reduce((s, v) => s + v, 0);
  return exps.map(v => v / total);
};
export const predictClass = (weights, x) => {
  const scores = scoresOf(weights, x);
  return scores.indexOf(Math.max(...scores));
};

export function validateModel(model) {
  if (model?.policy !== CLONE_POLICY || !Array.isArray(model.weights) || model.weights.length !== CLASSES.length ||
      model.weights.some(row => !Array.isArray(row) || row.length !== FEATURE_NAMES.length ||
        row.some(w => !Number.isFinite(w)))) throw Error('INVALID_SCHEMA');
  return model;
}

const MOVE_VECTORS = { still: [0, 0], toward: [1, 0], away: [-1, 0], up: [0, -1], down: [0, 1] };

/** A uniform roll in [0, 1) from the seat variant and the tick: the same inputs always give the same roll. */
const roll = (variant, tick) => {
  const mixed = ((variant >>> 0) ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0 || 1;
  return xorshift32(xorshift32(mixed)) / 4294967296;
};

export function makeClonedBot(model, { mode = 'sample' } = {}) {
  validateModel(model);
  const chooseActions = (view, seq, variant = 0) => {
    const x = extractFeatures(view);
    const legal = legalActions(view);
    if (!x || !legal.length) return [];
    let chosen;
    if (mode === 'argmax') chosen = predictClass(model.weights, x);
    else {
      const p = probabilities(model.weights, x);
      let target = roll(variant, view.tick), cumulative = 0;
      chosen = p.length - 1;
      for (let c = 0; c < p.length; c++) {
        cumulative += p[c];
        if (target < cumulative) {
          chosen = c;
          break;
        }
      }
    }
    const [attack, move] = CLASSES[chosen].split('/');
    const me = view.payload.entities.find(e => e.id === view.viewerId);
    const enemy = view.payload.entities.find(e => e.id !== view.viewerId);
    const dx = enemy.x - me.x, dy = enemy.y - me.y, norm = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const [a, b] = MOVE_VECTORS[move];
    // `|| 0`: a product with a zero factor can be -0, which the schema refuses as a move component
    const moveParams = move === 'up' || move === 'down' ? { moveX: 0, moveY: b * 1000 } :
      { moveX: (a * sx * 1000) || 0, moveY: (a * sy * 1000) || 0 };
    const out = [];
    if (legal.some(l => l.actionId === 'move')) {
      out.push({ playerId: view.viewerId, seq, tick: view.tick + 1, turnId: 0, actionId: 'move', params: moveParams });
    }
    if (attack !== 'none' && legal.some(l => l.actionId === attack)) {
      const params = attack === 'guard' ? { aimX: 0, aimY: 0 } : { aimX: Math.trunc(dx * 1000 / norm) || 0,
        aimY: Math.trunc(dy * 1000 / norm) || 0 };
      if (attack === 'projectile' && !params.aimX && !params.aimY) params.aimX = 1000;
      out.push({ playerId: view.viewerId, seq: seq + 1, tick: view.tick + 1, turnId: 0, actionId: attack, params });
    }
    return out.sort((p, q) => compareIds(p.playerId, q.playerId) || p.seq - q.seq);
  };
  return { chooseActions, deriveBotSeed,
    botPolicyVersion: `${CLONE_POLICY}+${model.trainedOn?.rows ?? 0}` };
}
