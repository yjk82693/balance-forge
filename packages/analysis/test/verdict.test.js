import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePatch } from '../src/index.js';
import { fixture } from './helpers.js';

const pair = () => [fixture('report_baseline.json'), fixture('report_patched.json')];
const row = (r, dim) => r.rows.find((x) => x.dimension === dim);

test('fixtures: 79% -> 54% is accepted', () => {
  const [b, a] = pair();
  const v = judgePatch(b, a);
  assert.equal(v.verdict, 'accepted');
  assert.deepEqual(v.targets.map((t) => [t.matchup, t.before.rate, t.after.rate, t.outcome]),
    [['bari vs real_armor', 0.79, 0.54, 'improved']]);
});

test('no improvement or overshoot to the other side is rejected', () => {
  let [b, a] = pair();
  row(a, 'bari vs real_armor').winRate = 0.8;
  assert.equal(judgePatch(b, a).verdict, 'rejected');
  [b, a] = pair();
  row(a, 'bari vs real_armor').winRate = 0.3; // dist .2 < .29 but now extreme on other side? 0.7 > .65 -> new extreme
  assert.equal(judgePatch(b, a).verdict, 'rejected');
});

test('new extreme matchup above 65% is rejected even if target improved', () => {
  const [b, a] = pair();
  row(a, 'bari vs daewi').winRate = 0.7;
  const v = judgePatch(b, a);
  assert.equal(v.verdict, 'rejected');
  assert.match(v.reasons.join(), /new extreme/);
});

test('an extreme row that was already extreme before is not "new"', () => {
  const [b, a] = pair();
  row(b, 'real_armor vs sepia').winRate = 0.7;
  row(a, 'real_armor vs sepia').winRate = 0.68;
  assert.equal(judgePatch(b, a).verdict, 'accepted');
});

test('small samples after patch are inconclusive', () => {
  const [b, a] = pair();
  row(a, 'bari vs real_armor').games = 120;
  assert.equal(judgePatch(b, a).verdict, 'inconclusive');
});

test('invalid-match rate increase is rejected', () => {
  const [b, a] = pair();
  a.invalidMatches = 5;
  assert.equal(judgePatch(b, a).verdict, 'rejected');
});

test('mismatched seed set, unchanged hash, or no target is inconclusive', () => {
  let [b, a] = pair();
  a.seedSetId = 'other';
  assert.equal(judgePatch(b, a).verdict, 'inconclusive');
  [b, a] = pair();
  a.dataHash = b.dataHash;
  assert.equal(judgePatch(b, a).verdict, 'inconclusive');
  [b, a] = pair();
  b.rows.forEach((r) => (r.outlier = false));
  assert.equal(judgePatch(b, a).verdict, 'inconclusive');
  assert.equal(judgePatch(b, a, { targets: ['bari vs real_armor'] }).verdict, 'accepted');
});

// --- mirror matchups: not default targets, still part of the "new extreme" check ---
const mirrorRow = (winRate, outlier) => ({ dimension: 'bari vs bari', wins: Math.round(winRate * 200), games: 200,
  winRate, ci95: [0.9, 1], uses: 100, opportunities: 200, outlier });

test('a mirror outlier is not a default target', () => {
  const [b, a] = pair();
  b.rows.push(mirrorRow(1, true));
  a.rows.push(mirrorRow(1, true)); // first-seat advantage unchanged; was extreme before, so not "new"
  const v = judgePatch(b, a);
  assert.equal(v.verdict, 'accepted', v.reasons.join('; '));
  assert.deepEqual(v.targets.map((t) => t.matchup), ['bari vs real_armor']);
});

test('only mirror outliers: inconclusive, and the reason says why', () => {
  const [b, a] = pair();
  row(b, 'bari vs real_armor').outlier = false;
  b.rows.push(mirrorRow(1, true));
  a.rows.push(mirrorRow(1, true));
  const v = judgePatch(b, a);
  assert.equal(v.verdict, 'inconclusive');
  assert.match(v.reasons.join(), /only outliers are mirror/);
});

test('a mirror row that becomes extreme after the patch still rejects it', () => {
  const [b, a] = pair();
  b.rows.push(mirrorRow(0.5, false));
  a.rows.push(mirrorRow(0.8, true));
  const v = judgePatch(b, a);
  assert.equal(v.verdict, 'rejected');
  assert.match(v.reasons.join(), /new extreme matchup: bari vs bari/);
});

test('explicit targets may still name a mirror row', () => {
  const [b, a] = pair();
  b.rows.push(mirrorRow(1, true));
  a.rows.push(mirrorRow(0.55, false));
  const v = judgePatch(b, a, { targets: ['bari vs bari'] });
  assert.equal(v.verdict, 'accepted', v.reasons.join('; '));
});

// --- per-target gate: one target must really improve, none may really get worse ---
const rowOf = (dimension, rate, [low, high], games = 200, outlier = true) => ({ dimension,
  wins: Math.round(rate * games), games, winRate: rate, ci95: [low, high], uses: 0, opportunities: 0, outlier });
const reports = (beforeRows, afterRows) => {
  const [b, a] = pair();
  b.rows = beforeRows;
  a.rows = afterRows;
  return [b, a];
};
const outcomes = (v) => v.targets.map((t) => `${t.matchup}:${t.outcome}`);

test('targets carry both sides and an outcome, and the reasons name every target', () => {
  const [b, a] = pair();
  const v = judgePatch(b, a);
  const [t] = v.targets;
  assert.deepEqual(Object.keys(t).sort(), ['after', 'before', 'matchup', 'outcome']);
  assert.deepEqual(Object.keys(t.before).sort(), ['ci95', 'games', 'rate']);
  assert.equal(t.outcome, 'improved');
  assert.ok(v.reasons.some((r) => r.startsWith('bari vs real_armor: improved (79.0%')), v.reasons.join('; '));
});

test('one improved target is enough when another did not move (a saturated matchup cannot block it)', () => {
  const [b, a] = reports(
    [rowOf('bari vs daewi', 0.99, [0.96, 0.997]), rowOf('bari vs sepia', 0.88, [0.83, 0.92])],
    [rowOf('bari vs daewi', 0.99, [0.96, 0.997], 200, true), rowOf('bari vs sepia', 0.70, [0.63, 0.76])]);
  const v = judgePatch(b, a);
  assert.deepEqual(outcomes(v), ['bari vs daewi:unchanged', 'bari vs sepia:improved']);
  assert.equal(v.verdict, 'accepted', v.reasons.join('; '));
});

test('a target that really got worse rejects the patch even if another improved', () => {
  const [b, a] = reports(
    [rowOf('bari vs daewi', 0.70, [0.64, 0.76]), rowOf('bari vs sepia', 0.88, [0.83, 0.92])],
    [rowOf('bari vs daewi', 0.64, [0.57, 0.70]), rowOf('bari vs sepia', 0.60, [0.53, 0.66])]);
  assert.equal(judgePatch(b, a).verdict, 'accepted'); // sanity: both closer to 50%
  const [b2, a2] = reports(
    [rowOf('bari vs daewi', 0.59, [0.53, 0.65]), rowOf('bari vs sepia', 0.88, [0.83, 0.92])],
    [rowOf('bari vs daewi', 0.645, [0.58, 0.71]), rowOf('bari vs sepia', 0.60, [0.53, 0.66])]);
  const v = judgePatch(b2, a2);
  assert.deepEqual(outcomes(v), ['bari vs daewi:worse', 'bari vs sepia:improved']);
  assert.equal(v.verdict, 'rejected');
  assert.match(v.reasons.join(), /moved away from their target beyond noise/);
});

test('moves inside the noise are unchanged: small shifts with overlapping intervals', () => {
  const [b, a] = reports([rowOf('bari vs daewi', 0.70, [0.64, 0.76])], [rowOf('bari vs daewi', 0.67, [0.61, 0.73])]);
  const v = judgePatch(b, a);
  assert.deepEqual(outcomes(v), ['bari vs daewi:unchanged']);
  assert.equal(v.verdict, 'rejected'); // enough games, nothing moved
  assert.match(v.reasons.join(), /no matchup moved toward its target beyond noise/);
});

test('improved by five points, or by an interval that clears the old one', () => {
  let [b, a] = reports([rowOf('x vs y', 0.70, [0.64, 0.76])], [rowOf('x vs y', 0.65, [0.59, 0.71])]);
  assert.deepEqual(outcomes(judgePatch(b, a)), ['x vs y:improved']); // exactly 5 points, with overlapping intervals
  [b, a] = reports([rowOf('x vs y', 0.60, [0.59, 0.61], 5000)], [rowOf('x vs y', 0.575, [0.57, 0.585], 5000)]);
  assert.deepEqual(outcomes(judgePatch(b, a)), ['x vs y:improved']); // only 2.5 points, but no interval overlap
  [b, a] = reports([rowOf('x vs y', 0.30, [0.24, 0.36])], [rowOf('x vs y', 0.40, [0.34, 0.46])]);
  assert.deepEqual(outcomes(judgePatch(b, a)), ['x vs y:improved']); // below 50%: moving up is toward 50%
  [b, a] = reports([rowOf('x vs y', 0.30, [0.24, 0.36])], [rowOf('x vs y', 0.22, [0.16, 0.28])]);
  assert.deepEqual(outcomes(judgePatch(b, a)), ['x vs y:worse']);
});

test('too few games after the patch: unchanged, and inconclusive when nothing else improved', () => {
  const [b, a] = reports([rowOf('x vs y', 0.80, [0.74, 0.85])], [rowOf('x vs y', 0.55, [0.45, 0.65], 100)]);
  const v = judgePatch(b, a);
  assert.deepEqual(outcomes(v), ['x vs y:unchanged']);
  assert.equal(v.verdict, 'inconclusive');
  assert.match(v.reasons.join(), /x vs y: holdout has 100 games; 200 needed/); // the cause is named, never silent
});

test('a new extreme matchup still rejects a patch whose target improved, and the targets are still listed', () => {
  const [b, a] = reports(
    [rowOf('bari vs daewi', 0.80, [0.74, 0.85]), rowOf('daewi vs sepia', 0.50, [0.43, 0.57], 200, false)],
    [rowOf('bari vs daewi', 0.55, [0.48, 0.62]), rowOf('daewi vs sepia', 0.70, [0.63, 0.76])]);
  const v = judgePatch(b, a);
  assert.equal(v.verdict, 'rejected');
  assert.deepEqual(outcomes(v), ['bari vs daewi:improved']);
});
