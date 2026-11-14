import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, hash, validate } from './index.ts';
import * as arena from '../games/action/index.ts';
// Contract v0.1.2: /characters/N/health and /characters/N/speed, integers, absolute bounds, and within 40% of the root.
const root = arena.data;
const patchOf = (data, path, value) => ({ baseDataHash: hash(data), replacements: [{ path, value }],
  rationale: 'test' });
const bari = root.characters.findIndex(c => c.id === 'bari');
const health = root.characters[bari].health, speed = root.characters[bari].speed;
const rejects = (data: any, path: string, value: number, base?: any) =>
  assert.throws(() => applyPatch(data, patchOf(data, path, value), base), /PATCH_REJECTED|INVALID_SCHEMA/,
    `${path}=${value}`);

test('the patch schema accepts hero stat paths and nothing else new', () => {
  validate('PatchProposal', patchOf(root, `/characters/${bari}/health`, health));
  validate('PatchProposal', patchOf(root, `/characters/${bari}/speed`, speed));
  for (const path of ['/characters/0/name', '/characters/x/health', '/characters/0/health/1', '/character/0/health',
    '/characters//speed', '/characters/01/health', '/moves/01/power', '/tuning/other']) {
    assert.throws(() => validate('PatchProposal', patchOf(root, path, 100)), /INVALID_SCHEMA/, path);
  }
  assert.throws(() => validate('PatchProposal', patchOf(root, `/characters/${bari}/health`, 1.5)), /INVALID_SCHEMA/);
});

test('health and speed move within 40% of the data value, with integer bounds', () => {
  const lowHealth = Math.ceil(health * 0.6), highHealth = Math.floor(health * 1.4);
  assert.equal(applyPatch(root, patchOf(root, `/characters/${bari}/health`, lowHealth)).characters[bari].health,
    lowHealth);
  assert.equal(applyPatch(root, patchOf(root, `/characters/${bari}/health`, highHealth)).characters[bari].health,
    highHealth);
  rejects(root, `/characters/${bari}/health`, lowHealth - 1);
  rejects(root, `/characters/${bari}/health`, highHealth + 1);
  const lowSpeed = Math.ceil(speed * 0.6), highSpeed = Math.floor(speed * 1.4);
  assert.equal(applyPatch(root, patchOf(root, `/characters/${bari}/speed`, highSpeed)).characters[bari].speed,
    highSpeed);
  rejects(root, `/characters/${bari}/speed`, lowSpeed - 1);
  rejects(root, `/characters/${bari}/speed`, highSpeed + 1);
  rejects(root, '/characters/99/health', 500);
  // the patch changes only that number, and the hash changes with it
  const patched = applyPatch(root, patchOf(root, `/characters/${bari}/health`, highHealth));
  assert.notEqual(hash(patched), hash(root));
  assert.deepEqual({ ...patched.characters[bari], health: health }, root.characters[bari]);
});

test('absolute bounds hold even when 40% of the root would allow more', () => {
  const big = structuredClone(root);
  big.characters[bari].health = 2800; // 40% above would be 3920: still capped at 3000
  big.characters[bari].speed = 380;
  rejects(big, `/characters/${bari}/health`, 3001);
  rejects(big, `/characters/${bari}/speed`, 401);
  assert.equal(applyPatch(big, patchOf(big, `/characters/${bari}/health`, 3000)).characters[bari].health, 3000);
});

test('the 40% bound is measured against the root, so repeated rounds cannot drift further', () => {
  const step1 = applyPatch(root, patchOf(root, `/characters/${bari}/health`, Math.floor(health * 1.3)), root);
  const next = Math.floor(health * 1.3 * 1.2); // +20% of the new value is beyond +40% of the root
  assert.ok(next > health * 1.4);
  rejects(step1, `/characters/${bari}/health`, next, root);
  // without a root the patched data is its own root: the drift would be allowed, which is why callers pass the root
  assert.doesNotThrow(() => applyPatch(step1, patchOf(step1, `/characters/${bari}/health`, next)));
  const ok = Math.floor(health * 1.4);
  assert.equal(applyPatch(step1, patchOf(step1, `/characters/${bari}/health`, ok), root).characters[bari].health, ok);
});

test('moves and the damage scale keep their old bounds and several paths can be mixed', () => {
  const proposal = { baseDataHash: hash(root), rationale: 'mix', replacements: [
    { path: '/moves/1/power', value: 72 }, { path: '/tuning/damageScalePermille', value: 900 },
    { path: `/characters/${bari}/speed`, value: speed + 10 }] };
  const patched = applyPatch(root, proposal);
  assert.equal(patched.moves[1].power, 72);
  assert.equal(patched.tuning.damageScalePermille, 900);
  assert.equal(patched.characters[bari].speed, speed + 10);
  rejects(root, '/tuning/damageScalePermille', 99);
  const twice = { ...proposal, replacements: [proposal.replacements[2], proposal.replacements[2]] };
  assert.throws(() => applyPatch(root, twice), /PATCH_REJECTED/); // a repeated path
});

// Hero Cards (contract v0.1.4): cost 1..3, power 1..10, no power on a peek card; both validators agree.
test('card patches: bounds, indexes and the peek card', async () => {
  const { data } = await import('../games/cards/index.ts');
  const propose = (path, value) => ({ baseDataHash: hash(data), replacements: [{ path, value }], rationale: 'test' });
  const cards = data.gameRules.cards;
  const peek = cards.findIndex(card => card.kind === 'peek');
  const spark = cards.findIndex(card => card.id === 'spark');
  assert.equal(applyPatch(data, propose(`/gameRules/cards/${spark}/power`, 5)).gameRules.cards[spark].power, 5);
  assert.equal(applyPatch(data, propose(`/gameRules/cards/${spark}/cost`, 3)).gameRules.cards[spark].cost, 3);
  for (const [path, value] of [[`/gameRules/cards/${spark}/cost`, 0], [`/gameRules/cards/${spark}/cost`, 4],
    [`/gameRules/cards/${spark}/power`, 0], [`/gameRules/cards/${spark}/power`, 11],
    [`/gameRules/cards/${peek}/power`, 2], ['/gameRules/cards/99/cost', 2]]) {
    assert.throws(() => applyPatch(data, propose(path, value)), /PATCH_REJECTED|INVALID_SCHEMA/, `${path}=${value}`);
  }
  assert.throws(() => applyPatch(data, propose('/gameRules/cards/01/cost', 2)), /INVALID_SCHEMA/);
  assert.throws(() => applyPatch(data, propose('/gameRules/health', 2)), /INVALID_SCHEMA/);
});
