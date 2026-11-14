import test from 'node:test';
import assert from 'node:assert/strict';
import { forensics, forensicsSentence, summarize } from '../pipeline/matchup-forensics.ts';
import { engineRoot } from './engine.ts';

const stubMatch = (swings, { winnerHero = 'real_armor', dist = [5000, 1800, 1500],
  legal = [false, true, false] } = {}) => ({ seed: 1, swap: false, seats: { p1: 'daewi', p2: 'real_armor' },
  winnerHero, duration: 40, hp: { daewi: 0, real_armor: 90 },
  ticks: dist.map((d, i) => ({ tick: i * 6, dist: d, legal: { p1: legal[i], p2: !legal[i] } })), swings });
const swing = (hero, startDist, outcome, start = 10, resolved = 13) => ({ hero, start, resolved, startDist, outcome });

test('summarize: swings by where they start and how they end, availability and the split by closing in', () => {
  const closing = stubMatch([swing('daewi', 1500, 'interrupted', 10, 16), swing('real_armor', 1500, 'landed'),
    swing('daewi', 3000, 'whiffed', 20, 30), swing('real_armor', 1200, 'blocked')]);
  const apart = stubMatch([swing('daewi', 3000, 'whiffed', 5, 15)], { dist: [5000, 3200, 3100], winnerHero: 'daewi' });
  const out = summarize([closing, apart], ['daewi', 'real_armor'], 1900);
  assert.equal(out.matches, 2);
  assert.equal(out.winRateFirst, 0.5);
  assert.deepEqual(out.neverWithinMeleeRange, { matches: 1, winsFirst: 1, meanTicks: 40 });
  assert.deepEqual(out.cameWithinMeleeRange, { matches: 1, winsFirst: 0, meanTicks: 40 });
  assert.deepEqual(out.swings.daewi.all, { starts: 3, landed: 0, blocked: 0, interrupted: 1, whiffed: 2 });
  assert.deepEqual(out.swings.daewi.inRange, { starts: 1, landed: 0, blocked: 0, interrupted: 1, whiffed: 0 });
  assert.equal(out.swings.daewi.outOfRangeStarts, 2);
  assert.deepEqual(out.swings.real_armor.inRange, { starts: 2, landed: 1, blocked: 1, interrupted: 0, whiffed: 0 });
  assert.deepEqual(out.meleeAvailability.daewi, { ticksWithinMeleeRange: 2, meleeAvailable: 1, share: 0.5 });
  assert.equal(out.meanTicksFromStartToResolve.daewi, 8.67); // (6 + 10 + 10) / 3
  assert.equal(out.firstHeroLosses.length, 1);
  assert.equal(out.firstHeroLosses[0].firstWithinRange, 6);
});

test('forensics on the real engine: swings add up, and bad input is an error result', async () => {
  const out = await forensics({ heroes: ['daewi', 'real_armor'], seeds: 3, engineRoot });
  assert.equal(out.ok, true, JSON.stringify(out));
  const v = out.value;
  assert.equal(v.matches, 6);
  assert.equal(v.meleeRange, 1900);
  for (const hero of ['daewi', 'real_armor']) {
    const { all, inRange, outOfRangeStarts } = v.swings[hero];
    assert.equal(all.starts, all.landed + all.blocked + all.interrupted + all.whiffed);
    assert.equal(all.starts, inRange.starts + outOfRangeStarts);
    assert.equal(inRange.whiffed, 0); // a swing started in range lands, is blocked or is interrupted
    assert.ok(v.meleeAvailability[hero].share >= 0 && v.meleeAvailability[hero].share <= 1);
  }
  assert.equal(v.neverWithinMeleeRange.matches + v.cameWithinMeleeRange.matches, 6);
  assert.equal(v.distanceProfile[0].meanDistance, 7600); // the start positions
  assert.deepEqual((await forensics({ heroes: ['daewi', 'daewi'], engineRoot })).error.code, 'INVALID_INPUT');
  assert.deepEqual((await forensics({ heroes: ['daewi', 'nobody'], engineRoot })).error.code, 'INVALID_INPUT');
  assert.deepEqual((await forensics({ heroes: 'daewi' })).error.code, 'INVALID_INPUT');
  assert.equal((await forensics({ heroes: ['a', 'b'], engineRoot: '/no/such/engine' })).ok, false);
});

test('forensicsSentence puts the numbers in one or two sentences', () => {
  const closing = stubMatch([swing('daewi', 1500, 'interrupted', 10, 16), swing('real_armor', 1500, 'landed'),
    swing('daewi', 3000, 'whiffed', 20, 30)]);
  const text = forensicsSentence(summarize([closing], ['daewi', 'real_armor'], 1900));
  assert.match(text,
    /^Replays of daewi vs real_armor: In range, daewi's swings landed 0% \(interrupted 100%, blocked 0%; 8 ticks/);
  assert.match(text, /against 100% for real_armor \(3 ticks\)\./);
  assert.match(text,
    /0 of 1 replays never came within melee range \(1900\); daewi started 50% of its swings out of range\./);
});
