import test from 'node:test';
import assert from 'node:assert/strict';
import { FakePatchAdapter, proposeValidated, validatePatch } from '../src/index.js';
import { fixture } from './helpers.js';

test('fake adapter returns the fixture example, pinned to the report hash', async () => {
  const report = fixture('report_baseline.json');
  const adapter = new FakePatchAdapter(fixture('patch_proposal.json'));
  const p = await proposeValidated(adapter, report, validatePatch);
  assert.deepEqual(p, fixture('patch_proposal.json'));
  assert.equal(p.baseDataHash, report.dataHash);
});

test('invalid proposal from an adapter is rejected before use', async () => {
  const bad = { ...fixture('patch_proposal.json'), replacements: [{ path: '/gameRules/x', value: 1 }] };
  await assert.rejects(proposeValidated(new FakePatchAdapter(bad), fixture('report_baseline.json'), validatePatch), /PATCH_REJECTED/);
});

