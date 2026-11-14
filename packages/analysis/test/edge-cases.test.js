import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyze, analyzeCards, buildMatchupTable, buildHumanGroup, buildPrompt, FakePatchAdapter, GeminiPatchAdapter, safe,
} from '../src/index.js';
import { analyzePhase } from '../pipeline/pipeline.js';
import { main } from '../pipeline/cli.js';
import { fixture, pairedResults } from './helpers.js';

// A runner bug: the match is marked valid but never finished.
const unfinished = () => pairedResults({ seeds: 3 }).map((r, i) => (
  i === 0 ? { ...r, outcome: { status: 'running', winners: [], reason: 'in_progress' } } : r
));

test('a "valid" match that is still running counts as invalid, never as a loss', () => {
  const report = analyze(unfinished());
  assert.equal(report.invalidMatches, 1);
  assert.equal(report.validMatches, 5);
  assert.equal(report.rows[0].games, 5);
  assert.equal(analyzePhase(unfinished()).report.invalidMatches, 1);
  assert.equal(buildHumanGroup(unfinished()).value.humanMatches, 5);
  assert.equal(buildMatchupTable(unfinished()).value.matchups[0].games, 5);
  assert.equal(analyzeCards(unfinished()).matches, 5);
});

test('adapters refuse a malformed report with a clear error instead of a TypeError', async () => {
  const fake = new FakePatchAdapter(fixture('patch_proposal.json'));
  await assert.rejects(fake.proposePatch(undefined), { code: 'INVALID_REPORT' });
  assert.throws(() => buildPrompt({ rows: 'x' }), { code: 'INVALID_REPORT' });
  const gemini = new GeminiPatchAdapter({ env: { GEMINI_API_KEY: 'k' }, fetch: async () => assert.fail('no call') });
  await assert.rejects(gemini.proposePatch(null), { code: 'INVALID_REPORT' });
});

test('safe API stays a result for an unfinished-only input', () => {
  const running = { status: 'running', winners: [], reason: 'x' };
  const allRunning = pairedResults({ seeds: 2 }).map((r) => ({ ...r, outcome: running }));
  const out = safe.analyzeResults(allRunning);
  assert.equal(out.ok, true);
  assert.equal(out.value.rows.length, 0);
  assert.equal(out.value.invalidMatches, 4);
});

test('CLI: metrics and baseline-report files must have the right shape', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-edge-'));
  const w = (name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
  const good = w('good.json', pairedResults({ seeds: 5 }));
  for (const bad of [null, [], 'text', 5]) {
    const r = await main(['propose', '--baseline', good, '--out', dir, '--metrics', w('m.json', bad)]);
    assert.equal(r.error.code, 'INVALID_INPUT', JSON.stringify(bad));
  }
  const out = join(dir, 'verify-out');
  await main(['propose', '--baseline', good, '--out', out]);
  writeFileSync(join(out, 'report_baseline.json'), '{"rows": 5}');
  const r = await main(['verify', '--holdout', good, '--out', out]);
  assert.equal(r.error.code, 'INVALID_REPORT');
});
