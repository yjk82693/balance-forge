import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, isOutlier, useRate, tooFewGames, wilson95 } from '../src/index.ts';
import { fixture } from './helpers.ts';

test('wilson matches fixture interval (158/200 -> 0.729..0.841)', () => {
  const [lo, hi] = wilson95(158, 200);
  assert.ok(Math.abs(lo - 0.729) < 0.001 && Math.abs(hi - 0.841) < 0.001);
  assert.deepEqual(wilson95(0, 0), [0, 1]);
  assert.throws(() => wilson95(5, 3));
});

test('fixture results: 1 win, 1 draw, 1 invalid separated', () => {
  const report = analyze(fixture('match_results.json'));
  assert.equal(report.validMatches, 2);
  assert.equal(report.invalidMatches, 1);
  assert.equal(report.draws, 1);
  const [row] = report.rows;
  assert.equal(row.dimension, 'p1 vs p2');
  assert.equal(row.games, 2);
  assert.equal(row.wins, 1);
  assert.equal(row.outlier, false); // n < 30 suppressed
  assert.equal(tooFewGames(row), true);
  assert.equal(row.uses, 194); // 2 valid matches x (30+55+12)
  assert.equal(row.opportunities, 720); // 2 x 360
});

test('outlier needs full interval outside 45-55% and n >= 30', () => {
  assert.equal(isOutlier(wilson95(158, 200), 200), true);
  assert.equal(isOutlier(wilson95(104, 200), 200), false);
  assert.equal(isOutlier(wilson95(30, 30), 30), true);
  assert.equal(isOutlier(wilson95(29, 29), 29), false); // n = 29 suppressed
  assert.equal(isOutlier([0.56, 0.7], 100), true);
  assert.equal(isOutlier([0.45, 0.7], 100), false); // lo=.45 is on the band edge, not outside
  assert.equal(isOutlier([0.2, 0.44], 100), true); // low side
});

test('zero opportunities is unavailable, not 0%', () => {
  assert.equal(useRate({ uses: 0, opportunities: 0 }), null);
  assert.equal(useRate({ uses: 5, opportunities: 20 }), 0.25);
});

test('dimensionOf resolver, deterministic output, mixed dataHash rejected', () => {
  const base = fixture('match_results.json')[0];
  const many = Array.from({ length: 40 }, (_, i) => ({ ...base, matchId: `m-${i}` }));
  const a = analyze(many, { dimensionOf: () => 'bari vs real_armor' });
  const b = analyze([...many].reverse(), { dimensionOf: () => 'bari vs real_armor' });
  assert.deepEqual(a, b);
  assert.equal(a.rows[0].winRate, 1);
  assert.equal(a.rows[0].outlier, true);
  const bad = { ...base, config: { ...base.config, dataHash: 'c'.repeat(64) } };
  assert.throws(() => analyze([base, bad]));
});
