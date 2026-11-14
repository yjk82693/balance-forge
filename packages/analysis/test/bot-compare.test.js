import test from 'node:test';
import assert from 'node:assert/strict';
import { addMatch, compareBots, POLICIES, reportOf } from '../pipeline/bot-compare.js';
import { engineRoot } from './engine.js';

const match = (seats, winner, swings, dists) => ({ seats, winner, winnerHero: winner ? seats[winner] : undefined,
  swings, ticks: dists.map((dist, tick) => ({ tick, dist })) });
const swing = (hero, startDist, outcome) => ({ hero, startDist, outcome, start: 1, resolved: 4 });
const fresh = () => ({ matchups: new Map(), heroes: new Map() });

test('addMatch and reportOf: first-hero wins with an interval, whiff rate per hero, ticks within melee range', () => {
  const totals = fresh();
  addMatch(totals, match({ p1: 'bari', p2: 'daewi' }, 'p1',
    [swing('bari', 3000, 'whiffed'), swing('daewi', 1500, 'landed')], [3000, 1500, 1000, 1000]), 1900);
  addMatch(totals, match({ p1: 'daewi', p2: 'bari' }, 'p1', [swing('daewi', 1800, 'interrupted')], [2000, 2000]), 1900);
  addMatch(totals, match({ p1: 'bari', p2: 'daewi' }, null, [], [1500, 1500]), 1900); // a draw: a game, not a win
  const report = reportOf('x', totals);
  const [row] = report.matchups;
  assert.equal(row.dimension, 'bari vs daewi');
  assert.deepEqual([row.games, row.winsFirst], [3, 1]); // bari won only the first; a draw is not a win
  assert.ok(row.ci95[0] < row.winRate && row.winRate < row.ci95[1]);
  assert.equal(row.shareOfTicksWithinMeleeRange, 0.625); // 5 of 8 ticks within 1900
  const bari = report.heroes.find((h) => h.hero === 'bari');
  assert.deepEqual([bari.starts, bari.whiffed, bari.whiffRate, bari.outOfRangeShare], [1, 1, 1, 1]);
  const daewi = report.heroes.find((h) => h.hero === 'daewi');
  assert.deepEqual([daewi.starts, daewi.landed, daewi.interrupted, daewi.whiffRate], [2, 1, 1, 0]);
  assert.equal(report.shareOfTicksWithinMeleeRange, 0.625);
});

test('a mirror counts first-seat wins and has one seat order', () => {
  const totals = fresh();
  addMatch(totals, match({ p1: 'sepia', p2: 'sepia' }, 'p1', [], [1000]), 1900);
  addMatch(totals, match({ p1: 'sepia', p2: 'sepia' }, 'p2', [], [1000]), 1900);
  const [row] = reportOf('x', totals).matchups;
  assert.deepEqual([row.dimension, row.games, row.winsFirst], ['sepia vs sepia', 2, 1]);
});

test('the three policies run on a tiny roster (1 pair): every matchup and hero is reported', async () => {
  const out = await compareBots({ pairs: 1, heroes: ['bari', 'daewi', 'sepia'], engineRoot });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.value.policies.map((p) => p.policy), ['scripted-0.2.1', 'scripted-0.2.2', 'scripted-0.2.2b']);
  for (const policy of out.value.policies) {
    assert.deepEqual(policy.matchups.map((m) => m.dimension), ['bari vs bari', 'bari vs daewi', 'bari vs sepia',
      'daewi vs daewi', 'daewi vs sepia', 'sepia vs sepia']);
    assert.deepEqual(policy.matchups.map((m) => m.games), [1, 2, 2, 1, 2, 1]); // mirrors one seat order, others two
    for (const h of policy.heroes) assert.equal(h.starts, h.landed + h.blocked + h.interrupted + h.whiffed);
    assert.ok(policy.shareOfTicksWithinMeleeRange >= 0 && policy.shareOfTicksWithinMeleeRange <= 1);
  }
  const [v1, v2, v2b] = out.value.policies;
  assert.ok(v1.heroes.some((h) => h.outOfRangeStarts > 0)); // 0.2.1 swings at nothing
  assert.ok(v2.heroes.every((h) => h.outOfRangeStarts === 0)); // 0.2.2 and 0.2.2b never do
  assert.ok(v2b.heroes.every((h) => h.outOfRangeStarts === 0));
  assert.equal(POLICIES.length, 3);
});

test('bad input is an error result', async () => {
  assert.equal((await compareBots({ pairs: 0, engineRoot })).error.code, 'INVALID_INPUT');
  assert.equal((await compareBots({ pairs: 1, heroes: ['nobody'], engineRoot })).error.code, 'INVALID_INPUT');
  assert.equal((await compareBots({ pairs: 1, engineRoot: '/no/such/engine' })).ok, false);
});
