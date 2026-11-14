import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosis, diagnosisMatchups, CLASSIFICATIONS } from '../src/diagnose.js';
import { pairedResults } from './helpers.js';

const DATA = { tuning: { damageScalePermille: 1000 },
  characters: ['bari', 'daewi', 'nightcrow', 'real_armor', 'sepia'].map((id) => ({ id,
    moveIds: [`${id}_melee`, `${id}_shot`, `${id}_guard`] })),
  moves: ['bari', 'daewi', 'nightcrow', 'real_armor', 'sepia'].flatMap((id) => [
    { id: `${id}_melee`, archetype: 'melee', power: 50 }, { id: `${id}_shot`, archetype: 'projectile', power: 90 },
    { id: `${id}_guard`, archetype: 'guard', power: 0 }]) };
const HEROES = DATA.characters.map((c) => c.id);

/** Results for a table { 'a vs b': rate of the first hero }, 100 seeds per matchup, with fixed action use counts. */
function world(table, { meleeUses = 10, shotUses = 40 } = {}) {
  return Object.entries(table).flatMap(([dimension, rate]) => {
    const [a, b] = dimension.split(' vs ');
    return pairedResults({ heroes: [a, b], seeds: 100, winner: (s) => (s % 100 < rate * 100 ? 'a' : 'b') })
      .map((r, i) => ({ ...r, matchId: `${dimension}-${i}`, statistics: { ...r.statistics, players: r.statistics.players
        .map((p) => ({ ...p, actions: [{ actionId: 'melee', opportunities: 100, uses: meleeUses },
          { actionId: 'projectile', opportunities: 100, uses: shotUses }, { actionId: 'guard', opportunities: 100,
            uses: 5 }] })) } }));
  });
}
const FAIR = 0.5;
const diagnose = (table, matchup, opts) => {
  const out = buildDiagnosis(world(table, opts), { matchup, data: DATA });
  assert.equal(out.ok, true, JSON.stringify(out));
  return out.value;
};

test('diagnosisMatchups: the focus heroes against every other hero, canonical order, 6 matchups for 5 heroes', () => {
  const list = diagnosisMatchups('bari vs daewi', HEROES);
  assert.deepEqual(list, ['bari vs nightcrow', 'bari vs real_armor', 'bari vs sepia', 'daewi vs nightcrow',
    'daewi vs real_armor', 'daewi vs sepia']);
  assert.deepEqual(diagnosisMatchups('nightcrow vs sepia', HEROES).slice(0, 2), ['bari vs nightcrow', 'bari vs sepia']);
});

test('overall_strong: the winner beats most other heroes, so the first recommendation is its nerf', () => {
  // Bari beats Daewi 99% and also beats nightcrow, real_armor, sepia; Daewi is fair against the others.
  const d = diagnose({ 'bari vs daewi': 0.99, 'bari vs nightcrow': 0.85, 'bari vs real_armor': 0.8,
    'bari vs sepia': 0.88, 'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR },
  'bari vs daewi');
  assert.equal(d.classification, 'overall_strong');
  assert.equal(d.focusHero, 'bari');
  const [first, ...rest] = d.recommendations;
  assert.deepEqual([first.hero, first.role, first.direction, first.path], ['bari', 'winner', 'down', '/moves/1/power']);
  assert.ok(first.sizePct >= 5 && first.sizePct <= 30 && first.sizePct % 5 === 0);
  assert.match(first.expected, /^brings 4 of 4 matchups toward the band$/);
  assert.match(first.why, /most-used attack/);
  assert.ok(rest.some((r) => r.hero === 'daewi')); // the loser's buff comes after the winner's recommendations
  const bari = d.heroes.find((h) => h.hero === 'bari');
  assert.equal(bari.strength.role, 'winner');
  assert.equal(bari.strength.opponentsOutsideBand, 4);
  assert.equal(bari.strength.worstOpponent, 'daewi');
  assert.ok(bari.strength.marginPts > 30);
  assert.equal(bari.opponents.length, 4);
  assert.deepEqual(Object.keys(bari.overall).sort(), ['ci95', 'games', 'rate']);
});

test('overall_weak: the loser loses to most other heroes, so the first recommendation is its buff', () => {
  // Daewi loses to Bari (99%) and to nightcrow, real_armor, sepia; Bari is fair against the others.
  const d = diagnose({ 'bari vs daewi': 0.99, 'bari vs nightcrow': FAIR, 'bari vs real_armor': FAIR,
    'bari vs sepia': FAIR, 'daewi vs nightcrow': 0.15, 'daewi vs real_armor': 0.2, 'daewi vs sepia': 0.18 },
  'bari vs daewi');
  assert.equal(d.classification, 'overall_weak');
  assert.equal(d.focusHero, 'daewi');
  const first = d.recommendations[0];
  assert.deepEqual([first.hero, first.role, first.direction], ['daewi', 'loser', 'up']);
  const daewi = d.heroes.find((h) => h.hero === 'daewi');
  assert.equal(daewi.strength.role, 'loser');
  assert.equal(daewi.strength.opponentsOutsideBand, 4);
  assert.ok(daewi.strength.marginPts < -30);
  assert.equal(daewi.strength.worstOpponent, 'bari');
  assert.ok(d.recommendations.some((r) => r.hero === 'bari' && r.direction === 'down')); // the winner's nerf follows
});

test('counter_specific: both are fair elsewhere, so the interaction move of the matchup is changed', () => {
  const d = diagnose({ 'bari vs daewi': 0.9, 'bari vs nightcrow': FAIR, 'bari vs real_armor': FAIR,
    'bari vs sepia': FAIR, 'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR },
  'bari vs daewi');
  assert.equal(d.classification, 'counter_specific');
  assert.deepEqual(d.recommendations.map((r) => [r.hero, r.direction, r.scope]),
    [['bari', 'down', 'interaction'], ['daewi', 'up', 'interaction']]);
  assert.match(d.recommendations[0].expected, /brings 1 of 1 matchups/);
  assert.equal(d.heroes.find((h) => h.hero === 'bari').strength.opponentsOutsideBand, 1);
});

test('the lever is the most-used attack, from the use counts in the results', () => {
  const table = { 'bari vs daewi': 0.9, 'bari vs nightcrow': FAIR, 'bari vs real_armor': FAIR, 'bari vs sepia': FAIR,
    'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR };
  assert.equal(diagnose(table, 'bari vs daewi', { meleeUses: 10, shotUses: 40 }).recommendations[0].path,
    '/moves/1/power'); // projectile
  assert.equal(diagnose(table, 'bari vs daewi', { meleeUses: 60, shotUses: 5 }).recommendations[0].path,
    '/moves/0/power'); // melee
});

test('off against nearly everyone adds the global lever as a second recommendation for that hero', () => {
  const d = diagnose({ 'bari vs daewi': 0.99, 'bari vs nightcrow': 0.9, 'bari vs real_armor': 0.9, 'bari vs sepia': 0.9,
    'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR }, 'bari vs daewi');
  const bari = d.recommendations.filter((r) => r.hero === 'bari');
  assert.equal(bari.length, 2);
  assert.equal(bari[1].path, '/tuning/damageScalePermille');
  assert.equal(bari[1].scope, 'global');
  assert.match(bari[1].why, /global/);
  const fairer = diagnose({ 'bari vs daewi': 0.9, 'bari vs nightcrow': 0.9, 'bari vs real_armor': FAIR,
    'bari vs sepia': FAIR, 'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR },
  'bari vs daewi');
  assert.equal(fairer.recommendations.filter((r) => r.hero === 'bari' && r.scope === 'global').length, 0);
});

test('a bigger gap gives a bigger suggested change, in steps of 5 within 5..30', () => {
  const size = (rate) => diagnose({ 'bari vs daewi': rate, 'bari vs nightcrow': rate, 'bari vs real_armor': rate,
    'bari vs sepia': rate, 'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR },
  'bari vs daewi').recommendations[0].sizePct;
  assert.ok(size(0.9) > size(0.7));
  assert.equal(size(0.99), 30);
  assert.ok(size(0.7) >= 5);
});

test('bad input is an error result, never a throw', () => {
  assert.equal(buildDiagnosis([], { matchup: 'bari vs daewi', data: DATA }).error.code, 'NO_RESULTS');
  assert.equal(buildDiagnosis(world({ 'bari vs daewi': 0.9 }), { matchup: 'bari vs bari', data: DATA }).error.code,
    'INVALID_INPUT');
  assert.equal(buildDiagnosis(world({ 'bari vs daewi': 0.9 }), { matchup: 'bari vs daewi' }).error.code,
    'INVALID_INPUT');
  assert.equal(buildDiagnosis(null, { matchup: 'bari vs daewi', data: DATA }).ok, false);
  assert.deepEqual(CLASSIFICATIONS, ['overall_strong', 'overall_weak', 'counter_specific']);
});

test('only two heroes in the data: nothing else to compare, so the pairing itself is the diagnosis', () => {
  const d = diagnose({ 'bari vs daewi': 0.9 }, 'bari vs daewi');
  assert.equal(d.classification, 'counter_specific');
  assert.equal(d.heroes[0].opponents.length, 1);
});
