import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvidence, MISSING_FIELDS } from '../src/evidence.js';
import { analyze } from '../src/index.js';
import { runFull } from '../pipeline/full.js';
import { FakePatchAdapter } from '../src/index.js';
import { pairedResults } from './helpers.js';

// Known statistics: bari side p-damage 300 per match, 10 projectile uses of 20 opportunities, 5 guard uses of 10.
// The opponent deals 100 damage per match: melee 4 of 8.
const withStats = (results) => results.map((r) => {
  const heroOf = (id) => r.config.options.assignments[id];
  return { ...r, statistics: { ...r.statistics, players: r.config.players.map((playerId) => (heroOf(playerId) === 'bari'
    ? { playerId, wins: 0, draws: 0, damage: 300, actions: [{ actionId: 'projectile', opportunities: 20, uses: 10 },
      { actionId: 'guard', opportunities: 10, uses: 5 }] }
    : { playerId, wins: 0, draws: 0, damage: 100, actions: [{ actionId: 'melee', opportunities: 8, uses: 4 }] })) } };
});
const results = () => withStats(pairedResults({ seeds: 40, winner: () => 'a' })); // bari wins all 80 matches

test('an outlier row gets use rates, opportunities and damage share for both sides', () => {
  const rs = results();
  const out = buildEvidence(rs, analyze(rs));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.value.missing, MISSING_FIELDS);
  assert.equal(out.value.rows.length, 1);
  const row = out.value.rows[0];
  assert.equal(row.dimension, 'bari vs real_armor');
  assert.equal(row.games, 80);
  assert.equal(row.mirror, false);
  assert.equal(row.focal.hero, 'bari');
  assert.equal(row.other.hero, 'real_armor');
  assert.equal(row.focal.damage, 80 * 300);
  assert.equal(row.focal.damageShare, 0.75);
  assert.equal(row.other.damageShare, 0.25);
  assert.deepEqual(row.focal.actions, [
    { actionId: 'guard', opportunities: 800, uses: 400, useRate: 0.5, damage: null },
    { actionId: 'projectile', opportunities: 1600, uses: 800, useRate: 0.5, damage: null }]);
  assert.deepEqual(row.other.actions, [{ actionId: 'melee', opportunities: 640, uses: 320, useRate: 0.5, damage: null }]);
});

test('no damage by move or guard-hit data is invented: it is null and listed as missing', () => {
  const rs = results();
  const row = buildEvidence(rs, analyze(rs)).value.rows[0];
  assert.ok(row.focal.actions.every((a) => a.damage === null));
  assert.deepEqual(MISSING_FIELDS, ['damageByAction', 'hitsThroughGuard']);
});

test('rows that are not outliers get no block; zero opportunities and zero damage give null, not 0', () => {
  const balanced = withStats(pairedResults({ seeds: 40, winner: (s) => (s % 2 ? 'a' : 'b') }));
  assert.deepEqual(buildEvidence(balanced, analyze(balanced)).value.rows, []);
  const zero = results().map((r) => ({ ...r, statistics: { ...r.statistics, players: r.statistics.players.map((p) => ({
    ...p, damage: 0, actions: p.actions.map((a) => ({ ...a, opportunities: 0, uses: 0 })) })) } }));
  const row = buildEvidence(zero, analyze(zero)).value.rows[0];
  assert.equal(row.focal.damageShare, null);
  assert.ok(row.focal.actions.every((a) => a.useRate === null));
});

test('mirror rows are marked and both sides are the same hero', () => {
  const mirror = withStats(pairedResults({ heroes: ['bari', 'bari'], seeds: 40, winner: () => 'a' }));
  const row = buildEvidence(mirror, analyze(mirror)).value.rows[0];
  assert.equal(row.dimension, 'bari vs bari');
  assert.equal(row.mirror, true);
  assert.equal(row.focal.hero, row.other.hero);
});

test('human rows get no evidence block; bad input is an error result', () => {
  const rs = results();
  const report = analyze(rs);
  report.rows.push({ ...report.rows[0], dimension: 'human: bari vs real_armor' });
  assert.equal(buildEvidence(rs, report).value.rows.length, 1);
  assert.equal(buildEvidence(null, report).ok, false);
  assert.equal(buildEvidence(rs, {}).error.code, 'INVALID_REPORT');
  assert.equal(buildEvidence([], report).value.rows.length, 0);
});

test('runFull carries the evidence of the baseline outliers', async () => {
  const A = 'a'.repeat(64);
  const baseData = { moves: [{ id: 'melee', power: 50 }, { id: 'spirit_arrow', power: 92 }], tuning: {} };
  const hashData = (d) => (d.moves[1].power === 92 ? A : 'c'.repeat(64));
  const holdout = pairedResults({ dataHash: 'c'.repeat(64), seeds: 40, winner: () => 'a' })
    .map((m) => ({ ...m, config: { ...m.config, seed: m.config.seed + 999 } }));
  const out = await runFull({ baselineResults: results(), baseData, hashData, runHoldout: async () => holdout,
    holdoutSeeds: holdout.map((m) => m.config.seed), adapter: new FakePatchAdapter({ baseDataHash: A,
      replacements: [{ path: '/moves/1/power', value: 72 }], rationale: 'x' }) });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.value.evidence.rows[0].dimension, 'bari vs real_armor');
  assert.equal(out.value.evidence.rows[0].focal.damageShare, 0.75);
});
