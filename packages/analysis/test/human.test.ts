import test from 'node:test';
import assert from 'node:assert/strict';
import { addHumanRows, humanResultsOf, humanRows, botRows, withExtras, judgePatch, analyze,
  HUMAN_PREFIX } from '../src/index.ts';
import { fixture, pairedResults } from './helpers.ts';

test('extras are validated and optional', () => {
  const r = fixture('report_baseline.json');
  assert.deepEqual(withExtras(r), r);
  const x = withExtras(r, { elapsedMs: 3421, recorded: true, createdAt: '2026-11-14T01:00:00.000Z', humanMatches: 4 });
  assert.equal(x.elapsedMs, 3421);
  assert.equal(x.recorded, true);
  assert.throws(() => withExtras(r, { elapsedMs: 1.5 }));
  assert.throws(() => withExtras(r, { recorded: 'yes' }));
  assert.throws(() => withExtras(r, { createdAt: 'yesterday' }));
  assert.throws(() => withExtras(r, { humanMatches: -1 }));
});

test('human rows: prefixed, separate, small n suppressed, invalid skipped, bot totals unchanged', () => {
  const bot = analyze(pairedResults({ seeds: 100 }));
  const human = pairedResults({ seeds: 3, dataHash: 'd'.repeat(64) }); // 6 matches, other content version
  human[0].valid = false;
  const out = addHumanRows(bot, humanResultsOf({ results: human }));
  assert.equal(out.humanMatches, 5);
  assert.equal(out.validMatches, bot.validMatches);
  assert.equal(botRows(out).length, 1);
  const [h] = humanRows(out);
  assert.equal(h.dimension, `${HUMAN_PREFIX}bari vs real_armor`);
  assert.equal(h.games, 5);
  assert.equal(h.outlier, false); // n < 30
  assert.equal(addHumanRows(bot, []).humanMatches, 0);
  assert.throws(() => humanResultsOf({ nope: 1 }));
});

test('human rows never gate a patch verdict', () => {
  const before = fixture('report_baseline.json');
  const after = fixture('report_patched.json');
  const extreme = { dimension: `${HUMAN_PREFIX}bari vs real_armor`, wins: 190, games: 200, winRate: 0.95, ci95: [0.9,
    0.97], uses: 0, opportunities: 0, outlier: true };
  assert.equal(judgePatch(before, { ...after, rows: [...after.rows, extreme] }).verdict, 'accepted');
});
