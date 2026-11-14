import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosis, diagnosisMatchups, CLASSIFICATIONS } from '../src/diagnose.js';
import { analyze, buildPrompt, FallbackAdapter } from '../src/index.js';
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
  assert.match(first.why, /its own attack, no other hero has it/);
  assert.deepEqual(first.alsoAffects, []);
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
  assert.ok(d.recommendations.every((r) => r.scope === 'interaction'));
  assert.deepEqual([...new Set(d.recommendations.map((r) => `${r.hero}:${r.direction}`))],
    ['bari:down', 'daewi:up']); // the winner's recommendations come first, then the loser's
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

test('there is never a global lever: scaling every hero is not a way to change one hero', () => {
  const d = diagnose({ 'bari vs daewi': 0.99, 'bari vs nightcrow': 0.9, 'bari vs real_armor': 0.9, 'bari vs sepia': 0.9,
    'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR }, 'bari vs daewi');
  assert.ok(d.recommendations.length > 0);
  assert.ok(d.recommendations.every((r) => r.path.startsWith('/moves/') && r.scope !== 'global'));
  assert.ok(d.recommendations.every((r) => r.hero === 'bari' || r.hero === 'daewi'));
  assert.ok(d.recommendations.filter((r) => r.hero === 'bari').length <= 2); // one or two per hero
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

test('the prompt carries the diagnosis as aggregate numbers only, and adapters pass the context on', async () => {
  const table = { 'bari vs daewi': 0.99, 'bari vs nightcrow': 0.85, 'bari vs real_armor': 0.8, 'bari vs sepia': 0.88,
    'daewi vs nightcrow': FAIR, 'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR };
  const results = world(table);
  const d = buildDiagnosis(results, { matchup: 'bari vs daewi', data: DATA }).value;
  const report = analyze(results.filter((r) => r.config.options.assignments.p1 !== 'zzz'));
  const prompt = buildPrompt(report, { diagnosis: d });
  assert.match(prompt, /Diagnosis of the flagged matchup/);
  assert.match(prompt, /"classification":"overall_strong"/);
  assert.match(prompt, /"direction":"down"/);
  assert.doesNotMatch(prompt, /matchId|finalStateHash|statistics/); // no raw match data
  assert.doesNotMatch(buildPrompt(report), /Diagnosis of the flagged matchup/); // without context nothing changes
  const seen = [];
  const spy = (name, fail) => ({ async proposeWithOrigin(r, context) {
    seen.push([name, context]);
    if (fail) throw new Error('down');
    return { proposal: { baseDataHash: r.dataHash, replacements: [], rationale: '' }, origin: name };
  } });
  await new FallbackAdapter(spy('primary', true), spy('backup', false)).proposeWithOrigin(report, { diagnosis: d });
  assert.deepEqual(seen.map(([name, context]) => [name, context.diagnosis === d]),
    [['primary', true], ['backup', true]]);
});

// --- shared moves: melee, projectile and guard belong to several heroes; a hero's own moves rank first ---
const SHARED = { tuning: { damageScalePermille: 1000 },
  characters: [{ id: 'bari', moveIds: ['melee', 'spirit_arrow', 'guard'] },
    { id: 'daewi', moveIds: ['heavy_melee', 'projectile', 'guard'] },
    { id: 'real_armor', moveIds: ['melee', 'projectile', 'guard'] },
    { id: 'sepia', moveIds: ['melee', 'projectile', 'guard'] }],
  moves: [{ id: 'melee', archetype: 'melee', power: 50 }, { id: 'spirit_arrow', archetype: 'projectile', power: 92 },
    { id: 'heavy_melee', archetype: 'melee', power: 80 }, { id: 'projectile', archetype: 'projectile', power: 60 },
    { id: 'guard', archetype: 'guard', power: 0 }] };
const sharedDiagnosis = (table, matchup, opts, data = SHARED) => {
  const out = buildDiagnosis(world(table, opts), { matchup, data });
  assert.equal(out.ok, true, JSON.stringify(out));
  return out.value;
};
const pathOf = (data, id) => `/moves/${data.moves.findIndex((m) => m.id === id)}/power`;

test('a strong hero: its unique attack first, then the shared attack marked with the heroes it also changes', () => {
  const d = sharedDiagnosis({ 'bari vs daewi': 0.99, 'bari vs real_armor': 0.85, 'bari vs sepia': 0.9,
    'daewi vs real_armor': FAIR, 'daewi vs sepia': FAIR }, 'bari vs daewi', { meleeUses: 60, shotUses: 5 });
  const bari = d.recommendations.filter((r) => r.hero === 'bari');
  // Melee is Bari's most-used attack, but it is shared; spirit_arrow is only Bari's, so it ranks first.
  assert.deepEqual(bari.map((r) => r.path), [pathOf(SHARED, 'spirit_arrow'), pathOf(SHARED, 'melee')]);
  assert.deepEqual(bari[0].alsoAffects, []);
  assert.deepEqual(bari[1].alsoAffects, ['real_armor', 'sepia']);
  assert.match(bari[1].why, /shared with real_armor, sepia: this also changes them, so it ranks below/);
  assert.match(bari[0].why, /its own attack, no other hero has it/);
});

test('a weak hero is buffed through its own move even when its most-used attack is shared', () => {
  const d = sharedDiagnosis({ 'bari vs daewi': 0.99, 'bari vs real_armor': FAIR, 'bari vs sepia': FAIR,
    'daewi vs real_armor': 0.15, 'daewi vs sepia': 0.2 }, 'bari vs daewi', { meleeUses: 5, shotUses: 70 });
  assert.equal(d.classification, 'overall_weak');
  const daewi = d.recommendations.filter((r) => r.hero === 'daewi');
  // Projectile (shared with real_armor and sepia) is the most used, heavy_melee is only Daewi's.
  assert.equal(d.recommendations[0].hero, 'daewi');
  assert.deepEqual(daewi.map((r) => r.path), [pathOf(SHARED, 'heavy_melee'), pathOf(SHARED, 'projectile')]);
  assert.deepEqual(daewi.map((r) => r.direction), ['up', 'up']);
  assert.deepEqual(daewi[1].alsoAffects, ['real_armor', 'sepia']);
  assert.ok(d.recommendations.every((r) => r.path !== pathOf(SHARED, 'guard')), 'guard is shared and not an attack');
});

test('a hero that owns only shared moves: shared attacks by use, marked with the heroes it also changes', () => {
  // 'real_armor vs sepia' 0.1 means sepia wins 90%: sepia is the strong one here, and it owns only shared moves.
  const d = sharedDiagnosis({ 'real_armor vs sepia': 0.1, 'bari vs sepia': 0.12, 'daewi vs sepia': 0.15,
    'bari vs real_armor': FAIR, 'bari vs daewi': FAIR, 'daewi vs real_armor': FAIR }, 'real_armor vs sepia',
  { meleeUses: 20, shotUses: 50 });
  assert.equal(d.classification, 'overall_strong');
  const sepia = d.recommendations.filter((r) => r.hero === 'sepia');
  assert.deepEqual(sepia.map((r) => r.path), [pathOf(SHARED, 'projectile'), pathOf(SHARED, 'melee')]); // by use
  assert.deepEqual(sepia[0].alsoAffects, ['daewi', 'real_armor']);
  assert.deepEqual(sepia[1].alsoAffects, ['bari', 'real_armor']);
  assert.ok(sepia.every((r) => /shared with/.test(r.why) && r.direction === 'down'));
});

test('the unique non-attack move is a lever before any shared attack', () => {
  const data = structuredClone(SHARED);
  data.characters.find((c) => c.id === 'sepia').moveIds = ['melee', 'projectile', 'ink_guard'];
  data.moves.push({ id: 'ink_guard', archetype: 'guard', power: 30 });
  const d = sharedDiagnosis({ 'bari vs sepia': 0.9, 'daewi vs sepia': 0.9, 'real_armor vs sepia': 0.9,
    'bari vs daewi': FAIR, 'bari vs real_armor': FAIR, 'daewi vs real_armor': FAIR }, 'bari vs sepia',
  { meleeUses: 20, shotUses: 50 }, data);
  const sepia = d.recommendations.filter((r) => r.hero === 'sepia');
  assert.equal(sepia[0].path, pathOf(data, 'ink_guard'));
  assert.deepEqual(sepia[0].alsoAffects, []);
  assert.match(sepia[0].why, /its own move, no other hero has it/);
  assert.equal(sepia[1].path, pathOf(data, 'projectile')); // the most-used shared attack comes next
  assert.deepEqual(sepia[1].alsoAffects, ['daewi', 'real_armor']);
});
