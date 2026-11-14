import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, bandOf, buildDiagnosis, buildPrompt, focusMatchupOf, heroOverallRows, heroTarget, judgePatch,
  normalizeIntent, pairKey, targetFor } from '../src/index.ts';
import { runFull } from '../pipeline/full.ts';
import { FakePatchAdapter } from '../src/index.ts';
import { fixture, pairedResults } from './helpers.ts';

const CLEAR = { version: 'v1', matchups: { 'bari vs real_armor': { favored: 'bari', strength: 'clear' } } };
const rate = (r) => (seed) => (seed % 100 < r * 100 ? 'a' : 'b');
const games = (heroes, r, seeds = 200, extra = {}) => pairedResults({ heroes, seeds, winner: rate(r), ...extra });
const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };

test('normalizeIntent: canonical keys, each pair once in either order, and every bad shape is a clear error', () => {
  const ok = normalizeIntent({ version: 'v1', matchups: { 'real_armor vs bari': { favored: 'bari', strength: 'clear' },
    'daewi vs sepia': { favored: null, strength: 'even' } }, notes: { 'sepia vs daewi': 'x' } });
  assert.deepEqual(Object.keys(ok.matchups).sort(), ['bari vs real_armor', 'daewi vs sepia']);
  assert.deepEqual(ok.notes, { 'daewi vs sepia': 'x' });
  assert.equal(pairKey('real_armor', 'bari'), 'bari vs real_armor');
  assert.equal(code(() => normalizeIntent({ version: 'v', matchups: { 'a vs b': { favored: 'a', strength: 'clear' },
    'b vs a': { favored: 'b', strength: 'slight' } } })), 'INVALID_INPUT'); // the same pair twice
  for (const bad of [null, [], 'x', {}, { version: '' }, { version: 'v', matchups: [] },
    { version: 'v', matchups: { 'a vs a': { favored: 'a', strength: 'clear' } } }, // a mirror
    { version: 'v', matchups: { 'a': { strength: 'even' } } },
    { version: 'v', matchups: { 'a vs b': { favored: 'a', strength: 'huge' } } },
    { version: 'v', matchups: { 'a vs b': { favored: 'a', strength: 'even' } } }, // even has no favorite
    { version: 'v', matchups: { 'a vs b': { favored: 'c', strength: 'clear' } } }, // favored is not in the pair
    { version: 'v', matchups: { 'a vs b': { strength: 'clear' } } },
    { version: 'v', matchups: { 'a vs b': 5 } },
    { version: 'v', matchups: {}, notes: { 'a vs b': 5 } }]) {
    assert.equal(code(() => normalizeIntent(bad)), 'INVALID_INPUT', JSON.stringify(bad));
  }
  assert.deepEqual(normalizeIntent({ version: 'v' }).matchups, {}); // no entries: everything even
});

test('targets: 50 / 55 / 60 / 65 for the favored side, from either side of a pair, a fair band of 5', () => {
  const intent = normalizeIntent({ version: 'v', matchups: {
    'bari vs real_armor': { favored: 'bari', strength: 'clear' },
    'bari vs sepia': { favored: 'sepia', strength: 'clear' },
    'bari vs daewi': { favored: 'bari', strength: 'slight' }, 'daewi vs nightcrow': { favored: 'nightcrow',
      strength: 'strong' }, 'daewi vs sepia': { favored: null, strength: 'even' } } });
  assert.equal(targetFor('bari vs real_armor', intent), 0.6); // the first hero is favored
  assert.equal(targetFor('bari vs sepia', intent), 0.4); // the second hero is favored: the first hero's target is 40%
  assert.equal(targetFor('bari vs daewi', intent), 0.55);
  assert.equal(targetFor('daewi vs nightcrow', intent), 0.35); // strong: 65% for nightcrow
  assert.equal(targetFor('daewi vs sepia', intent), 0.5);
  assert.equal(targetFor('nightcrow vs sepia', intent), 0.5); // no entry: even
  assert.equal(targetFor('bari vs bari', intent), 0.5); // a mirror has no intent
  assert.equal(targetFor('bari vs real_armor', null), 0.5);
  assert.equal(heroTarget('real_armor', 'bari', intent), 0.4);
  assert.equal(heroTarget('sepia', 'bari', intent), 0.6);
  assert.deepEqual(bandOf(0.6), [0.55, 0.65]);
  assert.deepEqual(bandOf(0.5), [0.45, 0.55]);
});

test('rows carry target and deltaToTarget; the outlier rule uses the target band; the report names the intent', () => {
  const on = analyze(games(['bari', 'real_armor'], 0.6), { intent: CLEAR }); // exactly on its intended 60%
  const [row] = on.rows;
  assert.deepEqual([row.target, row.deltaToTarget, row.winRate], [0.6, 0, 0.6]);
  assert.equal(row.outlier, false); // 60% would be an outlier against 50%, but it is intended
  assert.equal(on.intentVersion, 'v1');
  assert.equal(analyze(games(['bari', 'real_armor'], 0.62, 400), { intent: CLEAR }).rows[0].outlier, false); // within 5
  assert.equal(analyze(games(['bari', 'real_armor'], 0.62, 400)).rows[0].outlier, true); // no intent: against 50%
  const over = analyze(games(['bari', 'real_armor'], 0.72, 400), { intent: CLEAR }).rows[0];
  assert.equal(over.outlier, true);
  assert.equal(over.deltaToTarget, 0.12);
  const under = analyze(games(['bari', 'real_armor'], 0.45, 400), { intent: CLEAR }).rows[0];
  assert.equal(under.outlier, true); // far below its intended 60%, even though 45% looks fair against 50%
  assert.equal(under.deltaToTarget, -0.15);
  assert.equal(analyze(games(['bari', 'real_armor'], 0.62, 8), { intent: CLEAR }).rows[0].outlier, false); // n < 30
  assert.equal(code(() => analyze(games(['bari', 'real_armor'], 0.5), { intent: { version: '' } })), 'INVALID_INPUT');
});

test('an all-even intent reproduces today\'s results exactly: rows, outliers and the verdict', () => {
  const even = { version: 'all-even', matchups: {} };
  const strip = (report) => ({ ...report, intentVersion: undefined, rows: report.rows.map(({ target, deltaToTarget,
    ...rest }) => rest) });
  for (const winRate of [0.5, 0.58, 0.7, 0.8]) {
    const results = games(['bari', 'real_armor'], winRate);
    const plain = analyze(results);
    const withIntent = analyze(results, { intent: even });
    assert.deepEqual(JSON.parse(JSON.stringify(strip(withIntent))), JSON.parse(JSON.stringify(plain)));
    assert.ok(withIntent.rows.every((r) => r.target === 0.5 && r.deltaToTarget === Math.round((r.winRate - 0.5) * 1e6) /
      1e6));
  }
  const [b, a] = [fixture('report_baseline.json'), fixture('report_patched.json')];
  const intentReports = ([b, a].map((r) => ({ ...r, rows: r.rows.map((x) => ({ ...x, target: 0.5,
    deltaToTarget: Math.round((x.winRate - 0.5) * 1e6) / 1e6 })) }))) as [any, any];
  assert.deepEqual(judgePatch(...intentReports), judgePatch(b, a));
});

test('the verdict measures toward the target and "new extreme" is 15 points from the row\'s own target', () => {
  const row = (dimension, winRate, target, outlier = true) => ({ dimension, wins: Math.round(winRate * 200), games: 200,
    winRate, ci95: [winRate - 0.06, winRate + 0.06], uses: 0, opportunities: 0, outlier, target,
    deltaToTarget: Math.round((winRate - target) * 1e6) / 1e6 });
  const reports = (beforeRows, afterRows): [any, any] => {
    const [b, a] = [fixture('report_baseline.json'), fixture('report_patched.json')];
    return [{ ...b, rows: beforeRows }, { ...a, rows: afterRows }];
  };
  // a matchup intended at 60% that sits at 80% is moved to 62%: improved (toward its target, not toward 50%)
  let v = judgePatch(...reports([row('a vs b', 0.8, 0.6)], [row('a vs b', 0.62, 0.6, false)]));
  assert.equal(v.verdict, 'accepted', v.reasons.join('; '));
  assert.equal(v.targets[0].outcome, 'improved');
  // a flagged matchup at 65% (target 60%) that drops to 50% left its target by 10 points: worse, so the patch fails
  v = judgePatch(...reports([row('a vs b', 0.8, 0.6), row('c vs d', 0.65, 0.6)],
    [row('a vs b', 0.62, 0.6, false), row('c vs d', 0.5, 0.6)]));
  assert.equal(v.verdict, 'rejected');
  assert.deepEqual(v.targets.map((t) => [t.matchup, t.outcome]), [['a vs b', 'improved'], ['c vs d', 'worse']]);
  assert.match(v.reasons.join(), /moved away from their target beyond noise/);
  // 74% is only 14 points above a 60% target: not extreme. Against an even target it would be.
  v = judgePatch(...reports([row('a vs b', 0.8, 0.6), row('c vs d', 0.6, 0.6, false)],
    [row('a vs b', 0.62, 0.6, false), row('c vs d', 0.74, 0.6)]));
  assert.doesNotMatch(v.reasons.join(), /new extreme matchup: /);
  v = judgePatch(...reports([row('a vs b', 0.8, 0.6), row('c vs d', 0.6, 0.6, false)],
    [row('a vs b', 0.62, 0.6, false), row('c vs d', 0.76, 0.6)])); // 16 points from its own target
  assert.match(v.reasons.join(), /new extreme matchup: c vs d/);
  assert.equal(v.verdict, 'rejected');
  const evenTargets = judgePatch(...reports([row('a vs b', 0.8, 0.5), row('c vs d', 0.5, 0.5, false)],
    [row('a vs b', 0.62, 0.5, false), row('c vs d', 0.74, 0.5)]));
  assert.match(evenTargets.reasons.join(), /new extreme matchup: c vs d at 74%/);
  // exactly 15 points is not "more than 15"
  v = judgePatch(...reports([row('a vs b', 0.8, 0.6), row('c vs d', 0.6, 0.6, false)],
    [row('a vs b', 0.62, 0.6, false), row('c vs d', 0.75, 0.6)]));
  assert.doesNotMatch(v.reasons.join(), /new extreme matchup: /);
});

test('diagnosis margins are measured against the targets, and a hero far from 50% overall is flagged', () => {
  const DATA = { characters: ['bari', 'daewi', 'real_armor'].map((id) => ({ id, moveIds: [`${id}_m`] })),
    moves: ['bari', 'daewi', 'real_armor'].map((id) => ({ id: `${id}_m`, archetype: 'melee', power: 50 })) };
  const world = (table) => Object.entries(table).flatMap(([dimension, r]) => games(dimension.split(' vs '), r, 100)
    .map((m, i) => ({ ...m, matchId: `${dimension}-${i}` })));
  // bari is meant to beat real_armor (60%) and does, 70% is 10 points over its intent: bari is the one ahead of target
  const intent = { version: 'v', matchups: { 'bari vs real_armor': { favored: 'bari', strength: 'clear' } } };
  const over = buildDiagnosis(world({ 'bari vs real_armor': 0.7, 'bari vs daewi': 0.5, 'daewi vs real_armor': 0.5 }),
    { matchup: 'bari vs real_armor', data: DATA, intent });
  assert.equal(over.ok, true, JSON.stringify(over));
  const bari = over.value.heroes.find((h) => h.hero === 'bari');
  assert.equal(bari.strength.role, 'winner');
  const vsReal = bari.opponents.find((o) => o.opponent === 'real_armor');
  assert.deepEqual([vsReal.target, vsReal.deltaToTarget], [0.6, 0.1]);
  // the same 50% that is fair against an even target is 10 points short of an intended 60%: real_armor is "ahead"
  const under = buildDiagnosis(world({ 'bari vs real_armor': 0.5, 'bari vs daewi': 0.5, 'daewi vs real_armor': 0.5 }),
    { matchup: 'bari vs real_armor', data: DATA, intent });
  assert.equal(under.value.heroes.find((h) => h.hero === 'real_armor').strength.role, 'winner');
  const realArmor = under.value.heroes.find((h) => h.hero === 'real_armor');
  assert.equal(realArmor.opponents.find((o) => o.opponent === 'bari').target, 0.4);
  // overall flag: every matchup is intended, but bari wins 62% of its games overall
  const table = { 'bari vs real_armor': 0.7, 'bari vs daewi': 0.62, 'daewi vs real_armor': 0.5 };
  const flagged = buildDiagnosis(world(table),
    { matchup: 'bari vs real_armor', data: DATA, intent });
  assert.equal(flagged.value.heroes.find((h) => h.hero === 'bari').strength.overallOutsideBand, true);
  assert.equal(over.value.heroes.find((h) => h.hero === 'daewi')?.strength.overallOutsideBand ?? false, false);
  assert.equal('overallOutsideBand' in buildDiagnosis(world({ 'bari vs real_armor': 0.7, 'bari vs daewi': 0.5 }),
    { matchup: 'bari vs real_armor', data: DATA }).value.heroes[0].strength, false); // no intent: unchanged shape
  const rows = heroOverallRows(world({ 'bari vs real_armor': 0.9, 'bari vs daewi': 0.1, 'daewi vs real_armor': 0.5 }));
  assert.deepEqual(rows.map((r) => [r.hero, r.outlier]), [['bari', false], ['daewi', true], ['real_armor', true]]);
});

test('focusMatchupOf ranks by distance from the target', () => {
  const report = { rows: [{ dimension: 'a vs b', winRate: 0.7, deltaToTarget: 0.0, outlier: true },
    { dimension: 'c vs d', winRate: 0.6, deltaToTarget: -0.15, outlier: true }] };
  assert.equal(focusMatchupOf(report), 'c vs d');
  assert.equal(focusMatchupOf({ rows: [{ dimension: 'a vs b', winRate: 0.7, outlier: true },
    { dimension: 'c vs d', winRate: 0.6, outlier: true }] }), 'a vs b'); // no intent: distance from 50%
});

test('the prompt shows targets only when an intent gave non-even ones', () => {
  const plain = analyze(games(['bari', 'real_armor'], 0.8));
  const withIntent = analyze(games(['bari', 'real_armor'], 0.8), { intent: CLEAR });
  assert.doesNotMatch(buildPrompt(plain), /deltaToTarget|toward their own targets/);
  const prompt = buildPrompt(withIntent);
  assert.match(prompt, /toward their own targets, not toward 50%/);
  assert.match(prompt, /"target":0\.6,"deltaToTarget":0\.2/);
  const evenIntent = analyze(games(['bari', 'real_armor'], 0.8), { intent: { version: 'e', matchups: {} } });
  assert.doesNotMatch(buildPrompt(evenIntent), /toward their own targets/);
});

const BASE_HASH = 'a'.repeat(64);
const PATCHED_HASH = 'c'.repeat(64);
const baseData = { moves: [{ id: 'melee', power: 50 }, { id: 'spirit_arrow', power: 92 }], tuning: {} };
const hashData = (d) => (d.moves[1].power === 92 ? BASE_HASH : PATCHED_HASH);
const adapter = () => new FakePatchAdapter({ baseDataHash: BASE_HASH, rationale: 'x',
  replacements: [{ path: '/moves/1/power', value: 72 }] });
const seedsOf = (n, from) => Array.from({ length: n }, (_, i) => from + i);
const remap = (results, from) => results.map((m) => ({ ...m, config: { ...m.config, seed: from + m.config.seed } }));
const input = (r, extra = {}) => ({ baselineResults: games(['bari', 'real_armor'], r), baseData, hashData,
  holdoutSeeds: seedsOf(200, 10001), adapter: adapter(),
  runHoldout: async () => remap(games(['bari', 'real_armor'], 0.62, 200, { dataHash: PATCHED_HASH }), 10000),
  ...extra });

test('runFull under an intent: an intended matchup is fair without an adapter call; off-target goes on', async () => {
  let called = false;
  const spy = { async proposeWithOrigin() { called = true; throw new Error('no'); } };
  const fair = await runFull(input(0.6, { intent: CLEAR, adapter: spy }));
  assert.equal(fair.value.fair, true); // 60% is exactly its intended rate
  assert.equal(called, false);
  assert.equal(fair.value.intentVersion, 'v1');
  assert.equal(fair.value.baseline.intentVersion, 'v1');
  assert.deepEqual(fair.value.heroOverall.map((h) => h.hero), ['bari', 'real_armor']);
  const off = await runFull(input(0.8, { intent: CLEAR }));
  assert.equal(off.value.fair, false);
  assert.equal(off.value.baseline.rows[0].deltaToTarget, 0.2);
  assert.equal(off.value.patched.intentVersion, 'v1'); // the patched report records it too
  assert.equal(off.value.patched.rows[0].target, 0.6);
  assert.equal(off.value.verdict.verdict, 'accepted'); // 80% -> 62% is toward the 60% target
  const noIntent = await runFull(input(0.8));
  assert.equal(noIntent.value.intentVersion, undefined);
  assert.equal(noIntent.value.baseline.rows[0].target, undefined);
});

test('runFull with an all-even intent gives today\'s body plus only the intent fields', async () => {
  const even = { version: 'all-even', matchups: {} };
  for (const r of [0.5, 0.8]) {
    const plain = (await runFull(input(r))).value;
    const withEven = (await runFull(input(r, { intent: even }))).value;
    const strip = (body) => JSON.parse(JSON.stringify({ ...body, intentVersion: undefined, heroOverall: undefined,
      baseline: body.baseline && { ...body.baseline, intentVersion: undefined, rows: body.baseline.rows.map(
        ({ target, deltaToTarget, ...x }) => x) },
      patched: body.patched && { ...body.patched, intentVersion: undefined, rows: body.patched.rows.map(
        ({ target, deltaToTarget, ...x }) => x) } }));
    assert.deepEqual(strip(withEven), strip(plain));
  }
});
