import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localServer, http } from './test-helpers.ts';

const even = { version: 'all-even-test', matchups: {} };
const chart = { version: 'test-chart', matchups: {
  'bari vs daewi': { favored: 'bari', strength: 'clear' }
} };
const put = (server, intent) => http(server, '/v1/design/hero_arena/intent', { method: 'PUT', body: intent });
const full = (server, extra = {}) => http(server, '/v1/playtest/full', { method: 'POST', body: {
  gameId: 'hero_arena', heroes: ['bari', 'daewi'], pairs: 15, holdoutPairs: 15, ...extra } });
// Only what the analysis computed: wall-clock and id fields differ between two runs by design.
const analysed = body => JSON.parse(JSON.stringify(body, (key, value) =>
  ['runId', 'elapsedMs', 'createdAt', 'reanalyzed', 'reportId'].includes(key) ? undefined : value));

async function withDesignDir(t) {
  const directory = await mkdtemp(join(tmpdir(), 'design-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'hero_arena-intent.json'), JSON.stringify(even));
  return directory;
}

test('the intent is saved, read back and validated', async t => {
  const { server } = await localServer(t, { designDir: await withDesignDir(t) });
  assert.equal((await http(server, '/v1/design/hero_arena/intent')).json().version, 'all-even-test');
  assert.equal((await put(server, chart)).status, 200);
  const saved = (await http(server, '/v1/design/hero_arena/intent')).json();
  assert.equal(saved.version, 'test-chart');
  assert.deepEqual(saved.matchups, chart.matchups);
  const bad = [
    { matchups: { 'bari vs nobody': { favored: 'bari', strength: 'clear' } } },
    { matchups: { 'bari vs bari': { favored: null, strength: 'even' } } },
    { matchups: { 'bari vs daewi': { favored: 'bari', strength: 'huge' } } },
    { matchups: { 'bari vs daewi': { favored: 'bari', strength: 'clear' },
      'daewi vs bari': { favored: 'daewi', strength: 'slight' } } }
  ];
  for (const body of bad) {
    const response = await put(server, body);
    assert.equal(response.status, 400);
    assert.equal(response.json().code, 'INVALID_SCHEMA');
  }
  assert.equal((await http(server, '/v1/design/hero_arena/intent')).json().version, 'test-chart');
});

test('reanalyze under an intent equals a fresh run under that intent, and runs no simulation', async t => {
  const { server } = await localServer(t, { designDir: await withDesignDir(t) });
  const first = (await full(server)).json();
  assert.equal(first.baseline.intentVersion, 'all-even-test');
  // the same intent over the stored results reproduces the run
  const same = (await http(server, '/v1/playtest/reanalyze', { method: 'POST', body: { runId: first.runId } })).json();
  assert.equal(same.reanalyzed, true);
  assert.deepEqual(analysed({ ...same, runId: 0 }), analysed({ ...first, runId: 0 }));
  // another intent, by PUT or inline: same answer as a fresh run under it
  await put(server, chart);
  const again = await http(server, '/v1/playtest/reanalyze', { method: 'POST', body: { runId: first.runId } });
  const inline = await http(server, '/v1/playtest/reanalyze', { method: 'POST', body: { runId: first.runId,
    intent: chart } });
  const fresh = (await full(server)).json();
  assert.equal(fresh.baseline.intentVersion, 'test-chart');
  assert.deepEqual(analysed(again.json()), analysed(fresh));
  assert.deepEqual(analysed(inline.json()), analysed(fresh));
  assert.notDeepEqual(analysed(again.json().baseline.rows), analysed(first.baseline.rows));
  const unknown = await http(server, '/v1/playtest/reanalyze', { method: 'POST', body: {
    runId: '00000000-0000-4000-8000-000000000000' } });
  assert.equal(unknown.status, 400);
});

test('a PUT never touches the committed default: it writes the runtime intent, GET prefers it', async t => {
  const designDir = await withDesignDir(t);
  const defaultFile = join(designDir, 'hero_arena-intent.json');
  const before = await readFile(defaultFile, 'utf8');
  const { server } = await localServer(t, { designDir });
  assert.equal((await put(server, chart)).status, 200);
  assert.equal(await readFile(defaultFile, 'utf8'), before); // the committed default is read-only
  const runtime = join(server.storage.directory, 'data', 'design', 'hero_arena-intent.json');
  assert.equal(JSON.parse(await readFile(runtime, 'utf8')).version, 'test-chart');
  assert.equal((await http(server, '/v1/design/hero_arena/intent')).json().version, 'test-chart');
  assert.equal((await server.design.getDefault('hero_arena')).version, 'all-even-test'); // stable reads
});

test('a PUT without notes keeps the notes of the intent it replaces', async t => {
  const designDir = await withDesignDir(t);
  await writeFile(join(designDir, 'hero_arena-intent.json'), JSON.stringify({ version: 'noted',
    matchups: { 'bari vs daewi': { favored: 'bari', strength: 'slight' } },
    notes: { 'bari vs daewi': 'Bari has the reach.' } }));
  const { server } = await localServer(t, { designDir });
  const chips = { matchups: { 'bari vs daewi': { favored: 'bari', strength: 'strong' } } };
  const saved = (await put(server, chips)).json();
  assert.equal(saved.matchups['bari vs daewi'].strength, 'strong');
  assert.deepEqual(saved.notes, { 'bari vs daewi': 'Bari has the reach.' });
  assert.match(saved.version, /^intent-/);
  const again = (await put(server, { ...chips, notes: { 'bari vs daewi': 'New note.' } })).json();
  assert.deepEqual(again.notes, { 'bari vs daewi': 'New note.' }); // given notes replace them
});

test('the committed intent file is what the stable tools read', async () => {
  const committed = JSON.parse(await readFile(new URL('./design/hero_arena-intent.json', import.meta.url), 'utf8'));
  assert.equal(committed.version, '2026-11-14-v1');
  assert.ok(Object.keys(committed.notes).length >= 10);
});
