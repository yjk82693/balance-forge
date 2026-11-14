import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzePhase, proposeStep, verifyStep, singleGroup } from '../pipeline/pipeline.ts';
import { main } from '../pipeline/cli.ts';
import { groupByDataHash, pairBySeed, heroMatchup, createAdapter } from '../src/index.ts';
import { pairedResults } from './helpers.ts';

// bari wins 79% of seeds in baseline, 54% after the patch (hash cccc..).
const lopsided = (rate) => (seed) => (seed % 100 < rate * 100 ? 'a' : 'b');
const baseline = () => pairedResults({ seeds: 100, winner: lopsided(0.79), invalidSeeds: [] });
const holdout = () => pairedResults({ dataHash: 'c'.repeat(64), seeds: 100, winner: lopsided(0.54) });

test('hero matchup uses assignments, sorted, focal is the first hero', () => {
  const [r] = baseline();
  assert.deepEqual(heroMatchup(r), { dimension: 'bari vs real_armor', focal: 'p1' });
  const swapped = baseline()[1];
  assert.deepEqual(heroMatchup(swapped), { dimension: 'bari vs real_armor', focal: 'p2' });
});

test('groupByDataHash splits content versions; a phase needs exactly one', () => {
  const mixed = [...baseline(), ...holdout()];
  assert.equal(groupByDataHash(mixed).size, 2);
  assert.throws(() => singleGroup(mixed), /one dataHash/);
});

test('pairBySeed needs both seat-swapped valid matches', () => {
  const rs = pairedResults({ seeds: 5, invalidSeeds: [3] });
  const { pairs, unpaired } = pairBySeed(rs);
  assert.equal(pairs.length, 4);
  assert.equal(unpaired.length, 1); // seed 3's valid partner
  const lone = pairBySeed(rs.filter((r, i) => i % 2 === 0));
  assert.equal(lone.pairs.length, 0);
});

test('analyzePhase: swapped seats merge into one row; invalid and unpaired are separated', () => {
  const rs = pairedResults({ seeds: 100, winner: () => 'a', invalidSeeds: [3] });
  const { report, meta } = analyzePhase(rs);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].dimension, 'bari vs real_armor');
  assert.equal(report.invalidMatches, 1);
  assert.equal(meta.unpairedMatches, 1);
  assert.equal(report.validMatches, 198);
  assert.equal(report.rows[0].games, 198);
  assert.equal(report.rows[0].wins, 198); // bari always wins regardless of seat
});

test('full pipeline with the fake adapter: accepted', async () => {
  const base = analyzePhase(baseline(), { reportId: 'r-baseline' }).report;
  assert.equal(base.rows[0].outlier, true);
  const step = await proposeStep(base, createAdapter('fake'));
  assert.equal(step.ok, true);
  assert.equal(step.origin, 'fake');
  assert.equal(step.proposal.baseDataHash, base.dataHash);
  const out = verifyStep(base, holdout(), { reportId: 'r-patched' });
  assert.equal(out.verdict.verdict, 'accepted');
});

test('CLI writes the four files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-pipe-'));
  const b = join(dir, 'base.json'), h = join(dir, 'hold.json'), out = join(dir, 'out');
  writeFileSync(b, JSON.stringify(baseline()));
  writeFileSync(h, JSON.stringify(holdout()));
  const s = await main(['run', '--baseline', b, '--holdout', h, '--out', out, '--seed-set', 'pairs-100'], {},
    () => '2026-11-14T00:00:00.000Z');
  assert.equal(s.verdict, 'accepted');
  const rd = (n) => JSON.parse(readFileSync(join(out, n), 'utf8'));
  assert.equal(rd('report_baseline.json').createdAt, '2026-11-14T00:00:00.000Z');
  assert.equal(rd('report_baseline.json').seedSetId, 'pairs-100');
  assert.equal(rd('patch.json').replacements.length, 1);
  assert.equal(rd('report_patched.json').dataHash, 'c'.repeat(64));
  assert.equal(rd('verdict.json').patchOrigin, 'fake');
  // two-step mode gives the same verdict
  const out2 = join(dir, 'out2');
  await main(['propose', '--baseline', b, '--out', out2, '--seed-set', 'pairs-100']);
  assert.equal((await main(['verify', '--holdout', h, '--out', out2])).verdict, 'accepted');
});

test('CLI rejects unknown commands', async () => {
  const r = await main(['nope', '--out', tmpdir()]);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'USAGE');
});

test('CLI with gemini and no key falls back offline and records origin "fallback"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-fb-'));
  const b = join(dir, 'base.json'), h = join(dir, 'hold.json');
  writeFileSync(b, JSON.stringify(baseline()));
  writeFileSync(h, JSON.stringify(holdout()));
  const s = await main(['run', '--baseline', b, '--holdout', h, '--out', dir, '--adapter', 'gemini'], {});
  assert.equal(s.patchOrigin, 'fallback');
  const v = JSON.parse(readFileSync(join(dir, 'verdict.json'), 'utf8'));
  assert.equal(v.patchOrigin, 'fallback');
  assert.match(JSON.parse(readFileSync(join(dir, 'pipeline-meta.json'), 'utf8')).fallbackReason, /GEMINI_API_KEY/);
});

test('CLI adds extras and human rows when files are given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-x-'));
  const w = (n, v) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(v)); return p; };
  const b = w('b.json', baseline()), h = w('h.json', holdout());
  const m = w('m.json', { kind: 'recorded', elapsedMs: 3421.49 });
  const hu = w('hu.json', pairedResults({ seeds: 2, dataHash: 'd'.repeat(64) }));
  await main(['run', '--baseline', b, '--holdout', h, '--out', dir, '--metrics', m, '--human', hu], {});
  const rep = JSON.parse(readFileSync(join(dir, 'report_baseline.json'), 'utf8'));
  assert.equal(rep.elapsedMs, 3421);
  assert.equal(rep.recorded, true);
  assert.equal(rep.humanMatches, 4);
  assert.equal(rep.rows.length, 2);
  assert.equal(JSON.parse(readFileSync(join(dir, 'verdict.json'), 'utf8')).verdict, 'accepted');
});
