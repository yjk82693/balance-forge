import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safe, safely, isError, validatePatch, AnalysisError, assertMatchResults, assertReport, JsonFileStorage,
  buildMatchupTable, buildHumanGroup, pickLopsidedMatch, buildBeforeAfter, FakePatchAdapter } from '../src/index.js';
import { safe as pipelineSafe } from '../pipeline/pipeline.js';
import { main } from '../pipeline/cli.js';
import { fixture, pairedResults } from './helpers.js';

const CLI = fileURLToPath(new URL('../pipeline/cli.js', import.meta.url));
const GARBAGE = [undefined, null, 0, 5, 'x', true, [], {}, [null], [{}], [1, 2], { rows: 5 }, { results: 'x' },
  [{ valid: true }], () => 1, Symbol.iterator];
const isShape = (r) => r && typeof r === 'object' && (r.ok === true || isError(r));

test('safely: value, sync throw, async rejection, non-Error throw', async () => {
  assert.deepEqual(safely((x) => x + 1)(1), { ok: true, value: 2 });
  assert.equal(safely(() => { throw new AnalysisError('NO_RESULTS', 'none'); })().error.code, 'NO_RESULTS');
  assert.equal(safely(() => { throw 'oops'; })().error.code, 'INTERNAL');
  assert.equal((await safely(async () => { throw new AnalysisError('IO_ERROR', 'x'); })()).error.code, 'IO_ERROR');
  assert.deepEqual(await safely(async () => 7)(), { ok: true, value: 7 });
});

test('every safe entry point turns garbage into a result and never throws', async () => {
  const fns = {
    analyzeResults: (g) => safe.analyzeResults(g),
    judge: (g) => safe.judge(g, g),
    withHumanRows: (g) => safe.withHumanRows(g, g),
    cards: (g) => safe.cards(g),
    checkPatch: (g) => safe.checkPatch(g, g),
    applyPatch: (g) => safe.applyPatch(g, g),
    analyzePhase: (g) => pipelineSafe.analyzePhase(g),
    verifyStep: (g) => pipelineSafe.verifyStep(g, g),
    proposeStep: (g) => pipelineSafe.proposeStep(g, g),
    matchup: (g) => buildMatchupTable(g, g),
    human: (g) => buildHumanGroup(g),
    pick: (g) => pickLopsidedMatch(g, g),
    beforeAfter: (g) => buildBeforeAfter(g),
  };
  for (const [name, fn] of Object.entries(fns)) {
    for (const g of GARBAGE) {
      let out;
      try {
        out = await fn(g);
      } catch (e) {
        assert.fail(`${name} threw on ${String(g)}: ${e.message}`);
      }
      assert.ok(isShape(out), `${name} gave a non-result for ${String(g)}`);
    }
  }
});

test('validatePatch never throws, even for hostile objects', () => {
  const hostile = { get baseDataHash() { throw new Error('boom'); }, replacements: [], rationale: '' };
  for (const g of [...GARBAGE, hostile]) assert.doesNotThrow(() => validatePatch(g, g));
  assert.equal(validatePatch(hostile).ok, false);
});

test('specific codes: empty, mixed, malformed results; malformed reports', () => {
  assert.equal(safe.analyzeResults([]).error.code, 'NO_RESULTS');
  const mixed = [...pairedResults({ seeds: 2 }), ...pairedResults({ seeds: 2, dataHash: 'c'.repeat(64) })];
  assert.equal(safe.analyzeResults(mixed).error.code, 'MIXED_DATAHASH');
  const bad = safe.analyzeResults([{ matchId: 1 }]);
  assert.equal(bad.error.code, 'INVALID_INPUT');
  assert.match(bad.error.message, /results\[0\]/);
  assert.ok(bad.error.details.length <= 5);
  assert.equal(safe.judge({}, fixture('report_patched.json')).error.code, 'INVALID_REPORT');
  const r = fixture('report_baseline.json');
  r.rows[0].winRate = 7;
  assert.equal(safe.judge(r, fixture('report_patched.json')).error.code, 'INVALID_REPORT');
  assert.throws(() => assertMatchResults('x'), AnalysisError);
  assert.throws(() => assertReport(null), AnalysisError);
});

test('error messages never quote input values', () => {
  const marker = 'DISTINCTIVE-INPUT-VALUE';
  const out = safe.analyzeResults([{ matchId: marker, valid: marker, config: marker }]);
  assert.equal(out.ok, false);
  assert.doesNotMatch(JSON.stringify(out), new RegExp(marker));
});

test('all-invalid input: counted as invalid, not a crash', () => {
  const rs = pairedResults({ seeds: 3 }).map((r) => ({ ...r, valid: false, errorCode: 'HASH_MISMATCH' }));
  const out = safe.analyzeResults(rs);
  assert.equal(out.ok, true);
  assert.equal(out.value.invalidMatches, 6);
  assert.equal(out.value.rows.length, 0);
  assert.equal(pipelineSafe.analyzePhase(rs).error.code, 'NO_RESULTS');
});

test('proposeStep: adapter that throws or returns junk gives a result', async () => {
  const report = fixture('report_baseline.json');
  const boom = await pipelineSafe.proposeStep(report,
    { proposePatch: async () => { throw new Error('network down'); } });
  assert.equal(boom.error.code, 'ADAPTER_FAILED');
  const junk = await pipelineSafe.proposeStep(report, { proposePatch: async () => 42 });
  assert.equal(junk.ok, true);
  assert.equal(junk.value.ok, false); // step reports the invalid patch; callers decide
  assert.equal((await pipelineSafe.proposeStep(report, null)).error.code, 'INVALID_INPUT');
  const fake = await pipelineSafe.proposeStep(report, new FakePatchAdapter(fixture('patch_proposal.json')));
  assert.equal(fake.value.ok, true);
});

test('storage: bad ids, corrupt files and unwritable paths are coded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-err-'));
  const s = safe.safeStorage(new JsonFileStorage(join(dir, 'reports')));
  assert.equal((await s.saveReport(fixture('report_baseline.json'))).ok, true);
  assert.equal((await s.saveReport({ ...fixture('report_baseline.json'), reportId: '../x' })).error.code,
    'INVALID_INPUT');
  assert.equal((await s.saveReport({})).error.code, 'INVALID_REPORT');
  assert.equal((await s.getReport('missing')).value, null);
  writeFileSync(join(dir, 'reports', 'broken.json'), '{nope');
  assert.equal((await s.getReport('broken')).error.code, 'INVALID_JSON');
  assert.equal((await s.listReports()).error.code, 'INVALID_JSON');
  const blocked = safe.safeStorage(new JsonFileStorage(join(dir, 'reports', 'r-baseline.json',
    'sub'))); // parent is a file
  assert.equal((await blocked.saveReport(fixture('report_baseline.json'))).error.code, 'IO_ERROR');
});

test('CLI main always resolves a result: usage, missing file, bad JSON, bad shape, bad adapter, empty, unwritable',
  async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-cli-'));
  const w = (n, text) => { const p = join(dir, n); writeFileSync(p, typeof text === 'string' ? text :
    JSON.stringify(text)); return p; };
  const code = async (argv, env = {}) => { const r = await main(argv, env); assert.equal(r.ok, false,
    JSON.stringify(argv)); return r.error.code; };
  assert.equal(await code([]), 'USAGE');
  assert.equal(await code(['propose']), 'USAGE');
  assert.equal(await code(['propose', '--out']), 'USAGE');
  assert.equal(await code(['propose', 'oops']), 'USAGE');
  assert.equal(await code(['propose', '--out', dir]), 'USAGE'); // --baseline missing
  assert.equal(await code(['propose', '--baseline', join(dir, 'nope.json'), '--out', dir]), 'IO_ERROR');
  assert.equal(await code(['propose', '--baseline', w('bad.json', '{not json'), '--out', dir]), 'INVALID_JSON');
  assert.equal(await code(['propose', '--baseline', w('obj.json', { a: 1 }), '--out', dir]), 'INVALID_INPUT');
  assert.equal(await code(['propose', '--baseline', w('mal.json', [{ matchId: 'x' }]), '--out', dir]), 'INVALID_INPUT');
  assert.equal(await code(['propose', '--baseline', w('empty.json', []), '--out', dir]), 'NO_RESULTS');
  const good = w('good.json', pairedResults({ seeds: 5 }));
  assert.equal(await code(['propose', '--baseline', good, '--out', dir, '--adapter', 'nope']), 'USAGE');
  assert.equal(await code(['propose', '--baseline', good, '--out', dir, '--metrics', w('m.json',
    { elapsedMs: -5, kind: 'recorded' })]), 'INVALID_INPUT');
  assert.equal(await code(['propose', '--baseline', good, '--out', good]), 'IO_ERROR'); // out is a file
  assert.equal(await code(['verify', '--holdout', good, '--out', join(dir, 'fresh')]),
    'IO_ERROR'); // no baseline report yet
  assert.equal(await code(['replay', '--baseline', good, '--patch', w('p.json', { x: 1 }), '--out', dir]),
    'INVALID_PATCH');
  assert.equal(await code(['propose', '--baseline', good, '--out', dir, '--human', w('h.json', { nope: 1 })]),
    'INVALID_INPUT');
  const mixed = w('mixed.json', [...pairedResults({ seeds: 3 }),
    ...pairedResults({ seeds: 3, dataHash: 'c'.repeat(64) })]);
  assert.equal(await code(['propose', '--baseline', mixed, '--out', dir]), 'MIXED_DATAHASH');
  assert.equal(await main(undefined, {}).then((r) => r.error.code), 'USAGE');
});

test('a valid proposal leaves patch.json in place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-patchfile-'));
  const good = join(dir, 'good.json');
  writeFileSync(good, JSON.stringify(pairedResults({ seeds: 100, winner: (s) => (s % 10 < 8 ? 'a' : 'b') })));
  assert.equal((await main(['propose', '--baseline', good, '--out', dir])).ok, true);
  assert.equal(existsSync(join(dir, 'patch.json')), true);
});

test('real process: errors print JSON on stderr with exit code 1, success exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-proc-'));
  const bad = spawnSync(process.execPath, [CLI, 'propose', '--baseline', join(dir, 'missing.json'), '--out', dir],
    { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const err = JSON.parse(bad.stderr.trim());
  assert.equal(err.ok, false);
  assert.equal(err.error.code, 'IO_ERROR');
  assert.doesNotMatch(bad.stderr, /at .*\.js:\d+/); // no stack trace
  const none = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(none.status, 1);
  assert.equal(JSON.parse(none.stderr.trim()).error.code, 'USAGE');
  const f = join(dir, 'b.json');
  writeFileSync(f, JSON.stringify(pairedResults({ seeds: 5 })));
  const ok = spawnSync(process.execPath, [CLI, 'propose', '--baseline', f, '--out', join(dir, 'o')],
    { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout.trim()).ok, true);
});
