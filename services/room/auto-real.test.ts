// Real-module integration: /v1/playtest/auto with the actual packages/analysis runAuto (no injection), the fake
// adapter (analysisEnv is {}), real workers and temp storage. These assertions hold for any honest stop reason;
// they never force acceptance. Boundary/transport behaviour stays covered by the injected tests in auto.test.js.
// Opt-in: RUN_REAL_AUTO=1 node --test services/room/auto-real.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http } from './test-helpers.ts';
import { validate } from '../../packages/contracts/index.ts';

const gate = { skip: process.env.RUN_REAL_AUTO === '1' ? false
  : 'Requires RUN_REAL_AUTO=1 (real workers, about 8 minutes on the event laptop).' };
const stops = ['fair', 'not_accepted', 'regression', 'rounds', 'awaiting_approval'];

test('real runAuto: records chain from base, match the ledger and never claim a live LLM', gate, async t => {
  const { server, host } = await localServer(t);
  const base = server.storage.get('hero_arena');
  const response = await http(server, '/v1/playtest/auto', {
    method: 'POST', body: { gameId: 'hero_arena', rounds: 2, requireApproval: false }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.ok(stops.includes(body.stoppedBecause), `unexpected stop ${body.stoppedBecause} ${body.error?.code ?? ''}`);
  t.diagnostic(`stopped: ${body.stoppedBecause}, records: ${body.records.length}`);
  assert.ok(body.records.length <= 2);

  let parent = base.dataHash;
  for (const record of body.records) {
    assert.equal(record.parentHash, parent);
    assert.ok(['fake', 'fallback', 'manual'].includes(record.origin), `origin ${record.origin}`);
    const stored = server.storage.versionStore.get('hero_arena', record.dataHash);
    assert.deepEqual(stored, record);                     // the response never disagrees with the ledger
    if (record.approved) assert.equal(record.verdict?.verdict, 'accepted');
    if (record.verdict?.verdict === 'accepted' && record.approved) parent = record.dataHash;
  }
  if (body.stoppedBecause === 'regression') {
    assert.ok(body.records.some(record => record.verdict?.verdict === 'rejected' && !record.approved));
  }
  if (body.finalCheck !== null) validate('Report', body.finalCheck);

  const progress = host.messages.filter(message => message.type === 'playtest.progress').map(m => m.payload);
  assert.equal(`${progress[0].round}:${progress[0].phase}`, '1:scan');
  assert.ok(progress.every(update => update.round >= 1 && update.round <= 3 && update.runId === body.runId));
  assert.equal(server.storage.get('hero_arena').dataHash, base.dataHash); // auto never selects a version
});

test('real runAuto with approval required leaves every new version unapproved', gate, async t => {
  const { server } = await localServer(t);
  const response = await http(server, '/v1/playtest/auto', {
    method: 'POST', body: { gameId: 'hero_arena', rounds: 1 }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.ok(stops.includes(body.stoppedBecause), `unexpected stop ${body.stoppedBecause}`);
  for (const record of body.records) assert.equal(record.approved, false);
  if (body.records.some(record => record.verdict?.verdict === 'accepted')) {
    assert.equal(body.stoppedBecause, 'awaiting_approval');
    assert.equal(body.finalCheck, null);
  }
});
