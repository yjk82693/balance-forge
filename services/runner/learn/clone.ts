// Behaviour cloning (policy cloned-lr-1): a small multinomial logistic regression, written by hand, that predicts
// what a player does from the observation alone. Input features are numbers from the view (distance, direction to
// the opponent, cooldown and recovery of both sides, health, time until an incoming projectile arrives). The output
// class is a pair: which attack (none, melee, projectile, guard) and which movement (still, toward, away, up, down).
// Training data are decisions rebuilt by re-simulating recorded matches (the accepted input frames are recorded), so
// no simulation state is read by the learned bot itself. Deterministic: seeded initial weights, fixed full-batch
// steps. It needs enough human matches; `readiness` says whether there are, and nothing here claims more than the
// data allows.
import * as arena from '../../../packages/games/action/index.ts';
import { compareIds } from '../../../packages/contracts/index.ts';
import { round6 } from './stats.ts';
import { makeRng } from './rng.ts';

export const CLONE_POLICY = 'cloned-lr-1';
export const ATTACKS = ['none', 'melee', 'projectile', 'guard'];
export const MOVES = ['still', 'toward', 'away', 'up', 'down'];
export const CLASSES = ATTACKS.flatMap(attack => MOVES.map(move => `${attack}/${move}`));
export const FEATURE_NAMES = ['bias', 'distance', 'cosToEnemy', 'sinToEnemy', 'ownMeleeReady', 'ownProjectileReady',
  'ownGuardReady', 'ownBusy', 'enemyBusy', 'enemyMeleeReady', 'ownHp', 'enemyHp', 'incomingProjectile'];
export const MIN_MATCHES = 10; // fewer human matches than this: no model is trained or claimed

const ARENA = { w: 16000, h: 9000 };
const clamp01 = x => Math.max(0, Math.min(1, x));

/** The feature vector for one seat from an observation (inputs only). */
export function extractFeatures(view) {
  const me = view.payload.entities.find(e => e.id === view.viewerId);
  const enemy = view.payload.entities.find(e => e.id !== view.viewerId);
  if (!me || !enemy) return null;
  const dx = enemy.x - me.x, dy = enemy.y - me.y, dist = Math.hypot(dx, dy) || 1;
  const ready = (entity, index) => (entity.cooldowns[index] <= view.tick + 1 ? 1 : 0);
  const busy = entity => (entity.recoveryUntil > view.tick || entity.stunUntil > view.tick ||
    entity.pending.actionId ? 1 : 0);
  let arrival = 0;
  for (const shot of view.payload.projectiles) {
    if (shot.owner === me.id) continue;
    for (let t = 1; t <= shot.life; t++) {
      const px = shot.x + shot.vx * t - me.x, py = shot.y + shot.vy * t - me.y;
      if (px * px + py * py <= arena.data.gameRules.projectileRadius ** 2) {
        arrival = Math.max(arrival, 1 - t / shot.life);
        break;
      }
    }
  }
  return [1, clamp01(dist / Math.hypot(ARENA.w, ARENA.h)), dx / dist, dy / dist, ready(me, 0), ready(me, 1),
    ready(me, 2), busy(me), busy(enemy), ready(enemy, 0), me.hp / me.maxHp, enemy.hp / enemy.maxHp, arrival];
}

/** The class label of what a seat did in one frame (move relative to the opponent, plus the attack). */
export function labelOf(view, actions) {
  const me = view.payload.entities.find(e => e.id === view.viewerId);
  const enemy = view.payload.entities.find(e => e.id !== view.viewerId);
  const mine = actions.filter(a => a.playerId === view.viewerId);
  const attack = mine.find(a => ['melee', 'projectile', 'guard'].includes(a.actionId))?.actionId ?? 'none';
  const move = mine.find(a => a.actionId === 'move')?.params;
  let direction = 'still';
  if (move && (move.moveX || move.moveY)) {
    const along = (move.moveX * (enemy.x - me.x) + move.moveY * (enemy.y - me.y));
    const across = (move.moveX * (enemy.y - me.y) - move.moveY * (enemy.x - me.x));
    if (Math.abs(along) >= Math.abs(across)) direction = along > 0 ? 'toward' : 'away';
    else direction = move.moveY !== 0 && Math.abs(move.moveY) >= Math.abs(move.moveX) * 0.5 ?
      (move.moveY < 0 ? 'up' : 'down') : (along >= 0 ? 'toward' : 'away');
  }
  return CLASSES.indexOf(`${attack}/${direction}`);
}

/**
 * Samples (features, class) for `seat` by re-simulating a recording: { config, frames } with the matching game data.
 * Returns { rows: [{ x, y }], ticks }.
 */
export function datasetFromRecording(recording, seat, data = arena.data) {
  let state = arena.initial(recording.config, data);
  const rows = [];
  for (const frame of recording.frames) {
    const view = arena.observe(state, seat);
    const x = extractFeatures(view);
    if (x) rows.push({ x, y: labelOf(view, frame.actions) });
    state = arena.step(state, frame, data).state;
  }
  return { rows, ticks: recording.frames.length };
}

export function readiness(matchCount) {
  return { ready: matchCount >= MIN_MATCHES, matches: matchCount, needed: MIN_MATCHES,
    note: matchCount >= MIN_MATCHES ? 'enough matches to fit a model; the numbers still describe these players only'
      : `only ${matchCount} human matches (${MIN_MATCHES} needed): no model is trained and none is claimed` };
}

const softmax = scores => {
  const top = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - top));
  const total = exps.reduce((s, v) => s + v, 0);
  return exps.map(v => v / total);
};
const scoresOf = (weights, x) => weights.map(row => row.reduce((s, w, i) => s + w * x[i], 0));

/** Full-batch gradient descent on the cross-entropy with L2 weight decay. Deterministic given the seed. */
export function trainLogistic(rows, { seed = 1, steps = 200, rate = 0.5, l2 = 1e-3 } = {}) {
  if (!rows.length) throw Error('INVALID_SCHEMA');
  const rng = makeRng(seed);
  const weights = CLASSES.map(() => FEATURE_NAMES.map(() => (rng.uniform() - 0.5) * 0.02));
  for (let step = 0; step < steps; step++) {
    const gradient = CLASSES.map(() => FEATURE_NAMES.map(() => 0));
    for (const { x, y } of rows) {
      const p = softmax(scoresOf(weights, x));
      for (let c = 0; c < CLASSES.length; c++) {
        const error = p[c] - (c === y ? 1 : 0);
        for (let i = 0; i < x.length; i++) gradient[c][i] += error * x[i];
      }
    }
    for (let c = 0; c < CLASSES.length; c++) {
      for (let i = 0; i < FEATURE_NAMES.length; i++) {
        weights[c][i] -= rate * (gradient[c][i] / rows.length + l2 * weights[c][i]);
      }
    }
  }
  return weights.map(row => row.map(round6));
}

export const predictClass = (weights, x) => {
  const scores = scoresOf(weights, x);
  return scores.indexOf(Math.max(...scores));
};

/** Accuracy and the share of the most common class (the number to beat). */
export function evaluateModel(weights, rows) {
  const counts = new Map();
  let correct = 0;
  for (const { x, y } of rows) {
    counts.set(y, (counts.get(y) ?? 0) + 1);
    if (predictClass(weights, x) === y) correct += 1;
  }
  return { rows: rows.length, accuracy: round6(correct / (rows.length || 1)),
    majorityShare: round6(Math.max(0, ...counts.values()) / (rows.length || 1)) };
}

/** The model file: weights plus what they were trained on (shape of services/runner/learned/human-style.json). */
export function buildModel({ weights, rows, matches, seed, trainingAccuracy, heldOutAccuracy, dataHash, createdAt }) {
  return { policy: CLONE_POLICY, features: FEATURE_NAMES, classes: CLASSES, weights,
    trainedOn: { matches, rows, seed, dataHash }, accuracy: { training: trainingAccuracy, heldOut: heldOutAccuracy },
    readiness: readiness(matches), createdAt };
}

export function validateModel(model) {
  if (model?.policy !== CLONE_POLICY || !Array.isArray(model.weights) || model.weights.length !== CLASSES.length ||
      model.weights.some(row => !Array.isArray(row) || row.length !== FEATURE_NAMES.length ||
        row.some(w => !Number.isFinite(w)))) throw Error('INVALID_SCHEMA');
  return model;
}

const MOVE_VECTORS = { still: [0, 0], toward: [1, 0], away: [-1, 0], up: [0, -1], down: [0, 1] };

/** A bot that plays the predicted class: the most likely attack if it is legal, and the matching movement. */
export function makeClonedBot(model) {
  validateModel(model);
  const chooseActions = (view, seq) => {
    const x = extractFeatures(view);
    const legal = arena.legalActions(view);
    if (!x || !legal.length) return [];
    const [attack, move] = CLASSES[predictClass(model.weights, x)].split('/');
    const me = view.payload.entities.find(e => e.id === view.viewerId);
    const enemy = view.payload.entities.find(e => e.id !== view.viewerId);
    const dx = enemy.x - me.x, dy = enemy.y - me.y, norm = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const [a, b] = MOVE_VECTORS[move];
    const moveParams = move === 'up' || move === 'down' ? { moveX: 0, moveY: b * 1000 } :
      { moveX: a * sx * 1000, moveY: a * sy * 1000 };
    const out = [];
    if (legal.some(l => l.actionId === 'move') && move !== 'still') {
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
  return { chooseActions, deriveBotSeed: seed => seed,
    botPolicyVersion: `${CLONE_POLICY}+${model.trainedOn?.rows ?? 0}` };
}
