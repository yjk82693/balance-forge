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
  assert.deepEqual(v.targets.map((t) => [t.dimension, t.before, t.after, t.improved]),
    [['bari vs real_armor', 0.79, 0.54, true]]);
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
  assert.deepEqual(v.targets.map((t) => t.dimension), ['bari vs real_armor']);
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
