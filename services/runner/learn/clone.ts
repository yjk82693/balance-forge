// Behaviour cloning (policy cloned-lr-1): a small multinomial logistic regression, written by hand, that predicts
// what a player does from the observation alone. Input features are numbers from the view (distance, direction to
// the opponent, cooldown and recovery of both sides, health, time until an incoming projectile arrives). The output
// class is a pair: which attack (none, melee, projectile, guard) and which movement (still, toward, away, up, down).
// Training data are decisions rebuilt by re-simulating recorded matches (the accepted input frames are recorded), so
// no simulation state is read by the learned bot itself. Deterministic: seeded initial weights, fixed full-batch
// steps. It needs enough human matches; `readiness` says whether there are, and nothing here claims more than the
// data allows.
import * as arena from '../../../packages/games/action/index.ts';
import { ATTACKS, CLASSES, CLONE_POLICY, extractFeatures, FEATURE_NAMES, makeClonedBot, MOVES, predictClass,
  probabilities, validateModel } from '../../../packages/games/action/bot-cloned.ts';
import { round6 } from './stats.ts';
import { makeRng } from './rng.ts';

// The policy itself (features, classes, the bot) lives in packages/games/action/bot-cloned.ts; this file is the
// trainer: dataset from recordings, the regression, the evaluation and the model file.
export { ATTACKS, CLASSES, CLONE_POLICY, extractFeatures, FEATURE_NAMES, makeClonedBot, MOVES, predictClass,
  validateModel };
export const MIN_MATCHES = 10; // fewer human matches than this: no model is trained or claimed

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


/** Full-batch gradient descent on the cross-entropy with L2 weight decay. Deterministic given the seed. */
export function trainLogistic(rows, { seed = 1, steps = 200, rate = 0.5, l2 = 1e-3 } = {}) {
  if (!rows.length) throw Error('INVALID_SCHEMA');
  const rng = makeRng(seed);
  const weights = CLASSES.map(() => FEATURE_NAMES.map(() => (rng.uniform() - 0.5) * 0.02));
  for (let step = 0; step < steps; step++) {
    const gradient = CLASSES.map(() => FEATURE_NAMES.map(() => 0));
    for (const { x, y } of rows) {
      const p = probabilities(weights, x);
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
