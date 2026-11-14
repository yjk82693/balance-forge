import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePatch } from '../src/index.ts';
import { fixture } from './helpers.ts';

const base = () => fixture('patch_proposal.json');
const H = 'a'.repeat(64);
const rep = (path, value) => ({ ...base(), replacements: [{ path, value }] });

test('fixture proposal is valid against its hash', () => {
  assert.deepEqual(validatePatch(base(), { baseDataHash: H }), { ok: true, errors: [] });
});

test('hash mismatch and malformed hash rejected', () => {
  assert.equal(validatePatch(base(), { baseDataHash: 'b'.repeat(64) }).ok, false);
  assert.equal(validatePatch({ ...base(), baseDataHash: 'xyz' }).ok, false);
});

test('only allowlisted paths', () => {
  assert.equal(validatePatch(rep('/tuning/damageScalePermille', 900)).ok, true);
  assert.equal(validatePatch(rep('/moves/3/power', 10)).ok, true);
  for (const p of ['/moves/1/startupTicks', '/gameRules/x', '/moves/01/power', '/moves/-1/power', '/moves//power',
    'moves/1/power', '/moves/1/power/x'])
    assert.equal(validatePatch(rep(p, 10)).ok, false, p);
});

test('value bounds and integer-only', () => {
  assert.equal(validatePatch(rep('/tuning/damageScalePermille', 99)).ok, false);
  assert.equal(validatePatch(rep('/tuning/damageScalePermille', 3001)).ok, false);
  assert.equal(validatePatch(rep('/moves/1/power', -1)).ok, false);
  assert.equal(validatePatch(rep('/moves/1/power', 10001)).ok, false);
  assert.equal(validatePatch(rep('/moves/1/power', 0)).ok, true);
  assert.equal(validatePatch(rep('/moves/1/power', 72.5)).ok, false);
  assert.equal(validatePatch(rep('/moves/1/power', '72')).ok, false);
});

test('count limits: 1..8, no duplicate paths', () => {
  const mk = (n) => ({ ...base(), replacements: Array.from({ length: n },
    (_, i) => ({ path: `/moves/${i}/power`, value: 5 })) });
  assert.equal(validatePatch(mk(8)).ok, true);
  assert.equal(validatePatch(mk(9)).ok, false);
  assert.equal(validatePatch(mk(0)).ok, false);
  const dup = { ...base(), replacements: [{ path: '/moves/1/power', value: 1 }, { path: '/moves/1/power', value: 2 }] };
  assert.equal(validatePatch(dup).ok, false);
});

test('unknown fields, bad rationale, move index bound', () => {
  assert.equal(validatePatch({ ...base(), extra: 1 }).ok, false);
  assert.equal(validatePatch({ ...base(), rationale: 'x'.repeat(2001) }).ok, false);
  assert.equal(validatePatch(null).ok, false);
  assert.equal(validatePatch(rep('/moves/4/power', 5), { moveCount: 4 }).ok, false);
});
