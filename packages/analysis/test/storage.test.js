import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileStorage, TigerDataStorage } from '../src/index.js';
import { fixture } from './helpers.js';

const store = () => new JsonFileStorage(join(mkdtempSync(join(tmpdir(), 'bf-store-')), 'reports'));

test('save, get and list round-trip; missing dir lists empty', async () => {
  const s = store();
  assert.deepEqual(await s.listReports(), []);
  const a = { ...fixture('report_baseline.json'), createdAt: '2026-11-14T01:00:00.000Z' };
  const b = { ...fixture('report_patched.json'), createdAt: '2026-11-14T02:00:00.000Z', recorded: true };
  await s.saveReport(b);
  await s.saveReport(a);
  assert.deepEqual(await s.getReport('r-baseline'), a);
  assert.equal(await s.getReport('nope'), null);
  const list = await s.listReports();
  assert.deepEqual(list.map((x) => x.reportId), ['r-baseline', 'r-patched']); // oldest first
  assert.equal(list[1].recorded, true);
  assert.equal((await s.listReports({ gameId: 'other' })).length, 0);
});

test('report ids cannot escape the directory', async () => {
  const s = store();
  for (const id of ['../x', 'a/b', '..', '', '.hidden', 'a\\b'])
    await assert.rejects(s.saveReport({ ...fixture('report_baseline.json'), reportId: id }), { code: 'INVALID_INPUT' }, id);
});

test('TigerData placeholder is not wired', async () => {
  await assert.rejects(new TigerDataStorage().saveReport({}), /not implemented/);
  await assert.rejects(new TigerDataStorage().listReports(), /not implemented/);
});
