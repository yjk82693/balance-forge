import test from 'node:test';
import assert from 'node:assert/strict';
import { runFull } from '../pipeline/full.js';
import { FakePatchAdapter, validatePatch, applyPatchToData, buildPrompt, analyzeCardsByDeck } from '../src/index.js';
import { buildCardDiagnosis, cardVariants } from '../src/card-diagnose.js';
import { importEngine } from './engine.js';
import { pairedResults } from './helpers.js';

const { data } = await importEngine('packages/games/cards/index.js');
const { hash } = await importEngine('packages/contracts/index.js');
const base = structuredClone(data);
const DECKS = ['nightcrow', 'standard'];
const rate = (r) => (seed) => (seed % 100 < r * 100 ? 'a' : 'b');
const resultsAt = (dataHash, r, offset = 0, seeds = 100) => pairedResults({ dataHash, heroes: DECKS, seeds,
  winner: rate(r) }).map((m) => ({ ...m, config: { ...m.config, seed: m.config.seed + offset } }));
const idx = (id) => base.gameRules.cards.findIndex((c) => c.id === id);
const patch = (path, value) => ({ baseDataHash: hash(base), replacements: [{ path, value }], rationale: 'test' });

test('validator: card cost 1..3 and power 1..10, peek has no power, index must exist', () => {
  const ok = (path, value) => validatePatch(patch(path, value), { rootData: base }).ok;
  assert.equal(ok(`/gameRules/cards/${idx('spark')}/power`, 5), true);
  assert.equal(ok(`/gameRules/cards/${idx('spark')}/cost`, 3), true);
  assert.equal(ok(`/gameRules/cards/${idx('spark')}/cost`, 0), false);
  assert.equal(ok(`/gameRules/cards/${idx('spark')}/cost`, 4), false);
  assert.equal(ok(`/gameRules/cards/${idx('spark')}/power`, 0), false);
  assert.equal(ok(`/gameRules/cards/${idx('spark')}/power`, 11), false);
  assert.equal(ok(`/gameRules/cards/${idx('forethought')}/power`, 2), false); // a peek card has no power
  assert.equal(ok('/gameRules/cards/99/cost', 2), false);
  assert.equal(ok('/gameRules/cards/01/cost', 2), false);
  assert.equal(ok('/gameRules/health', 2), false);
});

test('applyPatchToData changes the card and leaves the original untouched', () => {
  const out = applyPatchToData(base, patch(`/gameRules/cards/${idx('sentinel')}/power`, 1), { hashData: hash });
  assert.equal(out.gameRules.cards[idx('sentinel')].power, 1);
  assert.equal(base.gameRules.cards[idx('sentinel')].power, 2);
});

test('the analysis validator and the engine applyPatch agree on card patches', async () => {
  const { applyPatch } = await importEngine('packages/contracts/index.js');
  const spark = idx('spark'), peek = idx('forethought');
  for (const [path, value] of [[`/gameRules/cards/${spark}/power`, 4], [`/gameRules/cards/${spark}/power`, 0],
    [`/gameRules/cards/${spark}/power`, 10], [`/gameRules/cards/${spark}/power`, 11],
    [`/gameRules/cards/${spark}/cost`, 1], [`/gameRules/cards/${spark}/cost`, 3], [`/gameRules/cards/${spark}/cost`, 4],
    [`/gameRules/cards/${peek}/power`, 3], [`/gameRules/cards/${peek}/cost`, 2], ['/gameRules/cards/7/cost', 2]]) {
    const proposal = patch(path, value);
    const mine = validatePatch(proposal, { rootData: base }).ok;
    let theirs = true;
    try { applyPatch(base, proposal, base); } catch { theirs = false; }
    assert.equal(mine, theirs, `${path}=${value}`);
  }
});

test('cardVariants: cost and power steps of the decks cards, within bounds, none for a peek power', () => {
  const variants = cardVariants(base, DECKS);
  assert.ok(variants.every((v) => v.to >= (v.field === 'cost' ? 1 : 1) && v.to <= (v.field === 'cost' ? 3 : 10)));
  assert.ok(!variants.some((v) => v.cardId === 'forethought' && v.field === 'power'));
  assert.ok(variants.some((v) => v.cardId === 'sentinel' && v.field === 'power' && v.to === 3));
  assert.ok(!variants.some((v) => v.cardId === 'spark' && v.field === 'cost' && v.to === 0));
  assert.deepEqual(cardVariants(base, ['standard']).filter((v) => v.cardId === 'mechanical_crows'), []);
});

test('buildCardDiagnosis ranks the lever that moves the rate toward the target, beyond noise', () => {
  const variants = cardVariants(base, DECKS);
  const sentinelUp = variants.find((v) => v.cardId === 'sentinel' && v.field === 'power' && v.to === 3);
  const sparkUp = variants.find((v) => v.cardId === 'spark' && v.field === 'power' && v.to === 4);
  const probes = [{ variant: null, results: resultsAt(hash(base), 0.4, 5000, 200) },
    { variant: sentinelUp, results: resultsAt('d'.repeat(64), 0.6, 5000, 200) }, // helps the first deck a lot
    { variant: sparkUp, results: resultsAt('e'.repeat(64), 0.41, 5000, 200) }]; // inside the noise
  const out = buildCardDiagnosis({ matchup: 'nightcrow vs standard', target: 0.5, probes });
  assert.equal(out.kind, 'cards');
  assert.equal(out.direction, 'up');
  assert.equal(out.levers[0].cardId, 'sentinel');
  assert.equal(out.levers[0].significant, true);
  assert.ok(out.levers[0].effect > 0.15);
  assert.ok(!out.levers.some((l) => l.cardId === 'spark')); // not significant: left out while a useful lever exists
});

test('analyzeCardsByDeck compares a card with its own deck, not with 50%', () => {
  const results = Array.from({ length: 60 }, (_, i) => {
    const r = resultsAt(hash(base), 0.9, 0, 1)[0];
    r.matchId = `x-${i}`;
    r.statistics.players[0].actions = [{ actionId: 'play:spark', opportunities: 2, uses: 1 }];
    r.statistics.players[1].actions = [{ actionId: 'play:spark', opportunities: 2, uses: 1 }];
    r.outcome = { status: 'win', winners: [i % 3 ? 'p1' : 'p2'], reason: 'hp_zero' };
    return r;
  });
  const out = analyzeCardsByDeck(results);
  assert.deepEqual(out.decks.map((d) => d.deck), ['nightcrow', 'standard']);
  const spark = out.cards.filter((c) => c.cardId === 'spark');
  assert.equal(spark.length, 2);
  // every card of a winning deck wins when played, and that alone is no flag
  assert.ok(spark.every((c) => c.dominant === false && c.weak === false));
});

test('the offline stand-in follows the best measured lever and the prompt lists card paths only', async () => {
  const report = { dataHash: hash(base), rows: [], gameId: 'hero_cards', simVersion: 'x', botPolicyVersion: 'b',
    seedSetId: 's', validMatches: 0, invalidMatches: 0, draws: 0, reportId: 'r', contractVersion: '0.1',
    schemaVersion: 1, humanMatches: 0 };
  const diagnosis = { kind: 'cards', matchup: 'nightcrow vs standard', focalDeck: 'nightcrow', focalRate: 0.4,
    target: 0.5, direction: 'up', levers: [{ path: '/gameRules/cards/2/power', cardId: 'sentinel', field: 'power',
      from: 2, to: 3, effect: 0.2, significant: true }] };
  const adapter = new FakePatchAdapter({ baseDataHash: '0'.repeat(64), replacements: [], rationale: '' });
  const got = await adapter.proposePatch({ ...report, rows: [] }, { rootData: base, diagnosis }).catch((e) => e);
  if (got instanceof Error) return assert.fail(got.message);
  assert.deepEqual(got.replacements, [{ path: '/gameRules/cards/2/power', value: 3 }]);
  assert.equal(validatePatch(got, { rootData: base }).ok, true);
  const prompt = buildPrompt({ ...report, rows: [] }, { rootData: base, diagnosis });
  assert.match(prompt, /gameRules\/cards\/<N>\/cost/);
  assert.doesNotMatch(prompt, /characters\/<N>\/health/);
  assert.doesNotMatch(prompt, /Heroes: \[\]/);
});

test('runFull on Hero Cards: baseline, card probes, proposal, holdout, per-target verdict', async () => {
  const baseHash = hash(base);
  const baseline = resultsAt(baseHash, 0.3, 0, 100);
  const patched = applyPatchToData(base, patch(`/gameRules/cards/${idx('sentinel')}/power`, 3), { hashData: hash });
  const patchedHash = hash(patched);
  const variants = cardVariants(base, DECKS);
  const lever = variants.find((v) => v.cardId === 'sentinel' && v.field === 'power' && v.to === 3);
  let probeSeen = 0;
  const out = await runFull({
    baselineResults: baseline, baseData: base, rootData: base, hashData: hash,
    holdoutSeeds: Array.from({ length: 100 }, (_, i) => 1001 + i),
    diagnoseSeeds: Array.from({ length: 100 }, (_, i) => 2001 + i),
    adapter: new FakePatchAdapter({ baseDataHash: '0'.repeat(64), replacements: [], rationale: '' }),
    runCardProbe: async (list) => {
      probeSeen = list.length;
      return [{ variant: null, results: resultsAt(baseHash, 0.3, 2000) },
        ...list.map((v) => ({ variant: v, results: resultsAt('f'.repeat(64),
          v.path === lever.path && v.to === lever.to ? 0.55 : 0.31, 2000) }))];
    },
    runHoldout: async () => resultsAt(patchedHash, 0.52, 1000),
    botPolicyVersion: 'cards-bot-0.1.0', seedSetId: 'paired-1-100', intent: { version: 'default', matchups: {} } });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.value.fair, false);
  assert.equal(probeSeen, cardVariants(base, DECKS).length);
  assert.equal(out.value.diagnosis.kind, 'cards');
  assert.equal(out.value.diagnosis.levers[0].path, lever.path);
  assert.deepEqual(out.value.proposal.replacements, [{ path: lever.path, value: 3 }]);
  assert.equal(out.value.proposal.changes[0].label, 'Sentinel · Power');
  assert.equal(out.value.proposal.changes[0].old, 2);
  assert.equal(out.value.patchedDataHash, patchedHash);
  assert.equal(out.value.verdict.verdict, 'accepted');
  assert.equal(out.value.verdict.targets[0].matchup, 'nightcrow vs standard');
});
