import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from './storage.js';
import { localServer, http } from './test-helpers.js';
const patch = (baseDataHash, value) => ({ baseDataHash,
  replacements: [{ path: '/moves/1/power', value }], rationale: 'Version branch test.' });

test('version roots, manual branches and approval survive a storage restart', async t => {
  const { server, root } = await localServer(t);
  const storage = server.storage, base = storage.get('hero_arena');
  const initial = storage.versionStore.list('hero_arena');
  assert.equal(initial.length, 1);
  assert.equal(initial[0].origin, 'base');
  assert.equal(initial[0].parentHash, null);
  const first = storage.patch('hero_arena', patch(base.dataHash, 72));
  const second = storage.patch('hero_arena', patch(base.dataHash, 64));
  assert.equal(storage.versionStore.list('hero_arena').length, 3);
  assert.equal(storage.versionStore.get('hero_arena', first.dataHash).parentHash, base.dataHash);
  assert.equal(storage.versionStore.get('hero_arena', second.dataHash).parentHash, base.dataHash);
  storage.versionStore.approve('hero_arena', first.dataHash);
  const restored = new Storage(root);
  assert.equal(restored.versionStore.get('hero_arena', first.dataHash).approved, true);
  assert.equal(restored.get('hero_arena').dataHash, second.dataHash);
  assert.equal(restored.get('hero_arena', base.dataHash).data.moves[1].power, 92);
  assert.equal((await readdir(join(root, 'data', 'versions'))).some(name => name.endsWith('.tmp')), false);
  assert.equal(JSON.parse(await readFile(join(root, 'data', 'versions', 'hero_arena.json'))).length, 3);
});
test('version list/detail/approval and current selection routes preserve room pins and retained data', async t => {
  const { server, host, room } = await localServer(t);
  const base = server.storage.get('hero_arena');
  const changed = server.storage.patch('hero_arena', patch(base.dataHash, 72));
  const list = await http(server, '/v1/versions/hero_arena');
  assert.equal(list.status, 200);
  assert.equal(list.json().versions.length, 2);
  assert.equal(list.json().currentHash, changed.dataHash); // apply-patch selects the new version
  const detail = await http(server, `/v1/versions/hero_arena/${changed.dataHash}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json().parentHash, base.dataHash);
  assert.deepEqual(detail.json().diff, [{ path: '/moves/1/power', old: 92, new: 72 }]);
  const approve = await http(server, `/v1/versions/hero_arena/${changed.dataHash}/approve`, {
    method: 'POST', body: {}
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.json().approved, true);
  host.request('game.select', { gameId: 'hero_arena', dataHash: changed.dataHash });
  const selected = await http(server, '/v1/data/hero_arena/select', {
    method: 'POST', body: { dataHash: base.dataHash }
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.json().currentHash, base.dataHash);
  assert.deepEqual(selected.json().versions, server.storage.versionStore.list('hero_arena')); // same list shape
  assert.equal((await http(server, '/v1/versions/hero_arena')).json().currentHash, base.dataHash);
  assert.equal((await http(server, '/v1/data/hero_arena')).json().dataHash, base.dataHash);
  assert.equal(room.selectedHash, changed.dataHash);
  host.request('match.start', { maxTicks: 1 });
  assert.equal(room.authority.config.dataHash, changed.dataHash);
  server.advance(room);
  assert.equal(server.storage.humans[0].valid, true);
  assert.equal((await http(server, `/v1/data/hero_arena?dataHash=${changed.dataHash}`)).status, 200);
});
test('unknown versions, cross-game selection and invalid approvals never mutate records or current pins', async t => {
  const { server } = await localServer(t);
  const base = server.storage.get('hero_arena');
  const before = server.storage.versionStore.list('hero_arena');
  const unknown = 'f'.repeat(64);
  assert.equal((await http(server, `/v1/versions/hero_arena/${unknown}`)).status, 404);
  assert.equal((await http(server, `/v1/versions/hero_arena/${unknown}/approve`, {
    method: 'POST', body: {}
  })).status, 404);
  for (const dataHash of [unknown, server.storage.get('hero_cards').dataHash, '../invalid']) {
    assert.equal((await http(server, '/v1/data/hero_arena/select', {
      method: 'POST', body: { dataHash }
    })).status, 400);
  }
  assert.equal((await http(server, `/v1/versions/hero_arena/${base.dataHash}/approve`, {
    method: 'POST', body: { approved: false }
  })).status, 400);
  assert.equal(server.storage.get('hero_arena').dataHash, base.dataHash);
  assert.deepEqual(server.storage.versionStore.list('hero_arena'), before);
});
test('full runs record their actual parent, proposal, reports and verdict without selecting the candidate', async t => {
  const { server } = await localServer(t);
  const base = server.storage.get('hero_arena');
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', pairs: 2, holdoutPairs: 2 }
  });
  assert.equal(response.status, 200);
  const body = response.json(), record = server.storage.versionStore.get('hero_arena', body.patchedDataHash);
  assert.equal(record.parentHash, base.dataHash);
  assert.equal(record.origin, 'fake');
  assert.equal(record.approved, false);
  assert.deepEqual(record.verdict, body.verdict);
  assert.equal(record.target.before.games, body.baseline.validMatches);
  assert.equal(record.target.after.games, body.patched.validMatches);
  assert.equal(server.storage.get('hero_arena').dataHash, base.dataHash);
});
test('retained data imports as labelled branches without changing data or current pins', async t => {
  const { server, root } = await localServer(t);
  const base = server.storage.get('hero_arena');
  const changed = server.storage.patch('hero_arena', patch(base.dataHash, 72));
  const { rm } = await import('node:fs/promises');
  await rm(join(root, 'data', 'versions', 'hero_arena.json'));
  const restored = new Storage(root);
  assert.equal(restored.get('hero_arena').dataHash, changed.dataHash);
  const record = restored.versionStore.get('hero_arena', changed.dataHash);
  assert.equal(record.parentHash, base.dataHash);
  assert.match(record.note, /Original lineage is unavailable/);
  assert.deepEqual(record.changes, [{ path: '/moves/1/power', old: 92, new: 72 }]);
  assert.equal(restored.versionStore.list('hero_arena').length, 2);
});
test('false diff metadata and missing parent hashes are rejected without overwriting history', async t => {
  const { server } = await localServer(t);
  const base = server.storage.get('hero_arena');
  const changed = server.storage.patch('hero_arena', patch(base.dataHash, 72));
  const record = server.storage.versionStore.get('hero_arena', changed.dataHash);
  assert.throws(() => server.storage.recordVersion({ ...record,
    changes: [{ path: '/moves/1/power', old: 92, new: 1 }] }), /HASH_MISMATCH/);
  assert.throws(() => server.storage.recordVersion({ ...record, parentHash: 'f'.repeat(64) }), /HASH_MISMATCH/);
  assert.deepEqual(server.storage.versionStore.get('hero_arena', changed.dataHash), record);
});
test('a later rejection of a stored version is kept; a repeat can never upgrade it', async t => {
  const { server } = await localServer(t);
  const storage = server.storage, base = storage.get('hero_arena');
  const { dataHash } = storage.patch('hero_arena', patch(base.dataHash, 72));
  const stored = storage.versionStore.get('hero_arena', dataHash);
  const accepted = { ...stored, verdict: { verdict: 'accepted', reasons: [] }, approved: true };
  storage.versionStore.approve('hero_arena', dataHash);
  const rejected = { ...accepted, verdict: { verdict: 'rejected', reasons: ['new extreme matchup'] },
    approved: false, note: 'rejected by the final roster check' };
  const kept = storage.recordVersion(rejected);
  assert.equal(kept.verdict.verdict, 'rejected');
  assert.equal(kept.approved, false);
  assert.equal(storage.versionStore.get('hero_arena', dataHash).verdict.verdict, 'rejected');
  assert.equal(storage.versionStore.get('hero_arena', dataHash).approved, false);
  const upgrade = storage.recordVersion({ ...rejected, verdict: { verdict: 'accepted', reasons: [] }, approved: true });
  assert.equal(upgrade.approved, false);
  assert.equal(storage.versionStore.get('hero_arena', dataHash).verdict.verdict, 'rejected');
  const relabel = storage.recordVersion({ ...rejected, rationale: 'rewritten history', origin: 'gemini' });
  assert.equal(relabel.rationale, stored.rationale);
  assert.equal(relabel.origin, stored.origin);
  assert.equal(storage.versionStore.list('hero_arena').length, 2);
});
test('a rejected version cannot be approved; an accepted or manual one can', async t => {
  const { server } = await localServer(t);
  const base = server.storage.get('hero_arena');
  const changed = server.storage.patch('hero_arena', patch(base.dataHash, 72));
  const record = server.storage.versionStore.get('hero_arena', changed.dataHash);
  server.storage.versionStore.add({ ...record, verdict: { verdict: 'rejected', reasons: ['final check'] },
    approved: false });
  const refused = await http(server, `/v1/versions/hero_arena/${changed.dataHash}/approve`, {
    method: 'POST', body: {}
  });
  assert.equal(refused.status, 400);
  assert.equal(server.storage.versionStore.get('hero_arena', changed.dataHash).approved, false);
});
