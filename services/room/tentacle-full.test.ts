import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localServer, http } from './test-helpers.ts';

test('full playtest on Tentacle Run: per-wave table, flagged wave, wave patch, holdout and verdict', async t => {
  const { server, host } = await localServer(t);
  host.request('match.start', { maxTicks: 1 });
  const originalHash = server.storage.get('tentacle_run').dataHash;
  const response = await http(server, '/v1/playtest/full', { method: 'POST',
    body: { gameId: 'tentacle_run', runs: 40 } });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.gameId, 'tentacle_run');
  assert.equal(body.botPolicyVersion, 'tentacle-bot-0.1.0');
  assert.equal(body.baseline.waves.length, 6);
  assert.equal(body.baseline.validRuns, 40);
  assert.equal(body.fair, false); // wave 4 is the designed flaw
  assert.equal(body.flaggedWave.wave, 4);
  assert.ok(body.flaggedWave.ci95[1] < body.flaggedWave.target - 0.1);
  assert.ok(body.proposal.changes.every(c => /^\/gameRules\/waves\/3\/(enemyDamage|fireIntervalTicks)$/.test(c.path)));
  assert.equal(body.proposal.changes[0].label, 'Wave 4 · Enemy damage');
  assert.equal(body.validation.ok, true);
  assert.equal(server.storage.get('tentacle_run').dataHash, originalHash); // candidates never replace the baseline
  assert.equal(server.storage.get('tentacle_run', body.patchedDataHash).dataHash, body.patchedDataHash);
  assert.equal(body.patched.waves.length, 6);
  assert.ok(['accepted', 'rejected', 'inconclusive'].includes(body.verdict.verdict));
  const stored = JSON.parse(await readFile(join(server.storage.directory, 'playtests', `${body.runId}-baseline.json`),
    'utf8'));
  assert.equal(stored.length, 40);
  assert.ok(stored[0].statistics.players[0].actions.some(a => a.actionId === 'wave:4:reached'));
  assert.equal(server.storage.versionStore.list('tentacle_run').length >= 2, true); // base + the candidate
  // a bad request still fails like the other games
  assert.equal((await http(server, '/v1/playtest/full', { method: 'POST',
    body: { gameId: 'tentacle_run', runs: 0 } })).status, 400);
});
