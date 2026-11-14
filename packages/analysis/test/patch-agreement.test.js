import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePatch, applyPatchToData, boundsFor, withinFortyPercent } from '../src/index.js';
import { PATCH_JSON_SCHEMA, PATH_PATTERN, buildPrompt } from '../src/llm.js';
import { importEngine } from './engine.js';
import { fixture } from './helpers.js';

// The engine (contracts applyPatch) and this package must accept and refuse exactly the same patches.
const semantics = await importEngine('packages/contracts/semantics.js');
const contracts = await importEngine('packages/contracts/index.js');
const arena = await importEngine('packages/games/action/index.js');
const root = arena.data;
const grown = structuredClone(root); // a later version of the data: bari has grown, the root is unchanged
grown.characters[0].health = Math.floor(root.characters[0].health * 1.3);
grown.characters[1].speed = Math.floor(root.characters[1].speed * 0.7);

const engineAccepts = (data, proposal) => {
  try {
    semantics.applyPatch(data, proposal, root);
    return true;
  } catch {
    return false;
  }
};
const mineAccepts = (data, proposal) => validatePatch(proposal, { baseDataHash: contracts.hash(data),
  moveCount: data.moves.length, rootData: root }).ok;

const paths = [...root.moves.map((_, i) => `/moves/${i}/power`), '/moves/99/power', '/moves/01/power',
  '/tuning/damageScalePermille', ...root.characters.flatMap((_, i) => [`/characters/${i}/health`,
    `/characters/${i}/speed`]), '/characters/99/health', '/characters/01/speed', '/characters/0/name',
  '/characters/-1/health', '/other/0/power'];
const valuesFor = (path) => {
  const stat = /^\/characters\/(\d+)\/(health|speed)$/.exec(path);
  if (!stat || !root.characters[Number(stat[1])]) {
    return [-1, 0, 1, 29, 30, 99, 100, 399, 400, 401, 3000, 3001, 10000, 10001, 1.5];
  }
  const r = root.characters[Number(stat[1])][stat[2]];
  const near = [Math.ceil(r * 0.6) - 1, Math.ceil(r * 0.6), Math.floor(r * 1.4), Math.floor(r * 1.4) + 1, r];
  return [...near, ...[29, 30, 100, 400, 401, 3000, 3001].filter((v) => v !== r), r + 0.5];
};

test('engine applyPatch and the analysis validator agree on every path and boundary value', () => {
  let compared = 0;
  const diffs = [];
  for (const data of [root, grown]) {
    for (const path of paths) {
      for (const value of valuesFor(path)) {
        const proposal = { baseDataHash: contracts.hash(data), replacements: [{ path, value }], rationale: 'x' };
        compared += 1;
        const [engine, mine] = [engineAccepts(data, proposal), mineAccepts(data, proposal)];
        if (engine !== mine) diffs.push(`${path}=${value} engine ${engine} mine ${mine}`);
      }
    }
  }
  assert.deepEqual(diffs, []);
  assert.ok(compared > 400, `compared ${compared}`);
});

test('two-path proposals, duplicates and the 8-change limit agree too', () => {
  const at = (path, value) => ({ path, value });
  const stat = root.characters[0].health;
  const cases = [
    [at('/characters/0/health', stat + 10), at('/characters/0/speed', root.characters[0].speed + 5)],
    [at('/characters/0/health', stat + 10), at('/characters/0/health', stat + 20)],
    [at('/moves/1/power', 72), at('/tuning/damageScalePermille', 900),
      at('/characters/1/health', root.characters[1].health)],
    Array.from({ length: 8 }, (_, i) => at(`/moves/${i}/power`, 40)),
    Array.from({ length: 9 }, (_, i) => at(`/moves/${i}/power`, 40)),
  ];
  for (const replacements of cases) {
    const proposal = { baseDataHash: contracts.hash(root), replacements, rationale: 'x' };
    assert.equal(mineAccepts(root, proposal), engineAccepts(root, proposal), JSON.stringify(replacements));
  }
});

test('applyPatchToData produces the data the engine produces', () => {
  const index = root.characters.findIndex((c) => c.id === 'daewi');
  const proposal = { baseDataHash: contracts.hash(root), rationale: 'x', replacements: [
    { path: `/characters/${index}/health`, value: Math.floor(root.characters[index].health * 1.3) },
    { path: `/characters/${index}/speed`, value: Math.ceil(root.characters[index].speed * 0.8) },
    { path: '/moves/1/power', value: 72 }] };
  const mine = applyPatchToData(root, proposal, { hashData: contracts.hash, rootData: root });
  assert.deepEqual(mine, semantics.applyPatch(root, proposal, root));
  assert.equal(contracts.hash(mine), contracts.hash(semantics.applyPatch(root, proposal, root)));
  // a drifted patch is refused by both, with a coded error here
  const drift = { baseDataHash: contracts.hash(grown), rationale: 'x',
    replacements: [{ path: '/characters/0/health', value: Math.floor(root.characters[0].health * 1.56) }] };
  assert.equal(engineAccepts(grown, drift), false);
  assert.throws(() => applyPatchToData(grown, drift, { hashData: contracts.hash, rootData: root }),
    (error) => error.code === 'INVALID_PATCH' && /within 40%/.test(error.message));
});

test('the LLM schema accepts the new paths and the prompt lists the heroes with their allowed ranges', () => {
  const pattern = new RegExp(PATH_PATTERN);
  assert.equal(PATCH_JSON_SCHEMA.properties.replacements.items.properties.path.pattern, PATH_PATTERN);
  for (const path of ['/characters/0/health', '/characters/12/speed', '/moves/3/power']) assert.match(path, pattern);
  for (const path of ['/characters/01/health', '/characters/0/name', '/characters/x/speed']) {
    assert.doesNotMatch(path, pattern);
  }
  const report = fixture('report_baseline.json');
  const prompt = buildPrompt(report, { rootData: root });
  assert.match(prompt, /\/characters\/<N>\/health/);
  assert.match(prompt, /within 40%|at most 40%/);
  const bari = root.characters[0];
  assert.ok(prompt.includes(`"id":"${bari.id}","health":{"original":${bari.health},"allowed":[${
    Math.ceil(bari.health * 0.6)},${Math.floor(bari.health * 1.4)}]}`), 'hero ranges are in the prompt');
  assert.doesNotMatch(buildPrompt(report), /Heroes: /); // without root data nothing about heroes is invented
  assert.deepEqual(boundsFor('/characters/0/health'), [100, 3000]);
  assert.deepEqual(boundsFor('/characters/0/speed'), [30, 400]);
  assert.equal(boundsFor('/characters/01/speed'), null);
  assert.equal(withinFortyPercent(60, 100), true);
  assert.equal(withinFortyPercent(59, 100), false);
  assert.equal(withinFortyPercent(140, 100), true);
  assert.equal(withinFortyPercent(141, 100), false);
});
