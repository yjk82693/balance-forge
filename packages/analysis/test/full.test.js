import test from 'node:test';
import assert from 'node:assert/strict';
import { runFull } from '../pipeline/full.js';
import { FakePatchAdapter } from '../src/index.js';
import { pairedResults } from './helpers.js';

const BASE_HASH = 'a'.repeat(64);
const PATCHED_HASH = 'c'.repeat(64);
const baseData = { moves: [{ id: 'melee', power: 50 }, { id: 'spirit_arrow', power: 92 }],
  characters: [{ id: 'bari', moves: ['melee', 'spirit_arrow'] }], tuning: { damageScalePermille: 1000 } };
// Stand-in hash: the base data and the data after the fake patch (spirit arrow 72) get the two known hashes.
const hashData = (d) => (d.moves[1].power === 92 ? BASE_HASH : PATCHED_HASH);
const proposal = { baseDataHash: BASE_HASH, replacements: [{ path: '/moves/1/power', value: 72 }],
  rationale: 'lower spirit arrow' };
const rate = (r) => (seed) => (seed % 100 < r * 100 ? 'a' : 'b');
const baselineResults = pairedResults({ seeds: 100, winner: rate(0.79) });
const holdoutSeeds = Array.from({ length: 100 }, (_, i) => 1000 + i);
const holdoutOf = (r, hash = PATCHED_HASH) => pairedResults({ dataHash: hash, seeds: 100, winner: rate(r) })
  .map((m) => ({ ...m, config: { ...m.config, seed: m.config.seed + 999 } }));

const input = (extra = {}) => ({ baselineResults, baseData, hashData, holdoutSeeds,
  adapter: new FakePatchAdapter(proposal), runHoldout: async () => holdoutOf(0.54), ...extra });
const code = (o) => (o.ok ? 'ok' : o.error.code);

test('runFull: shared-interface body, with old values in proposal.changes', async () => {
  let seen;
  const out = await runFull(input({ humanResults: [], runHoldout: async (data, seeds) => {
    seen = { data, seeds };
    return holdoutOf(0.54);
  } }));
  assert.equal(out.ok, true, JSON.stringify(out));
  const b = out.value;
  assert.equal(seen.data.moves[1].power, 72);
  assert.deepEqual(seen.seeds, holdoutSeeds);
  assert.equal(b.baseline.dataHash, BASE_HASH);
  assert.equal(b.patched.dataHash, PATCHED_HASH);
  assert.equal(b.patchedDataHash, PATCHED_HASH);
  assert.equal(b.proposal.origin, 'fake');
  assert.deepEqual(b.proposal.changes, [{ path: '/moves/1/power', label: 'Bari · Spirit Arrow power', old: 92,
    new: 72 }]);
  assert.deepEqual(b.validation, { ok: true, errors: [] });
  assert.equal(b.verdict.verdict, 'accepted', b.verdict.reasons.join('; '));
  assert.deepEqual(b.verdict.targets.map((t) => [t.matchup, t.outcome]), [['bari vs real_armor', 'improved']]);
  assert.equal(b.verdict.targets[0].before.rate, 0.79);
  assert.equal(b.verdict.targets[0].after.rate, 0.54);
  assert.equal(b.humanMatches, 0);
  assert.equal(b.botPolicyVersion, b.baseline.botPolicyVersion);
  assert.notEqual(b.holdoutSeedSetId, b.seedSetId);
  assert.equal(b.patched.seedSetId, b.holdoutSeedSetId);
});

test('runFull: a patch that makes things worse is rejected', async () => {
  const out = await runFull(input({ runHoldout: async () => holdoutOf(0.95) }));
  assert.equal(out.value.verdict.verdict, 'rejected');
});

test('runFull: human results add rows and humanMatches', async () => {
  const humans = pairedResults({ seeds: 3 }).slice(0, 5).map((r, i) => ({ ...r, matchId: `human-${i}` }));
  const out = await runFull(input({ humanResults: humans }));
  assert.equal(out.value.humanMatches, 5);
  assert.ok(out.value.baseline.rows.some((r) => r.dimension.startsWith('human: ')));
});

test('runFull: an invalid patch skips the holdout run and says so', async () => {
  let called = false;
  const bad = new FakePatchAdapter({ ...proposal, replacements: [{ path: '/moves/1/power', value: 99999 }] });
  const out = await runFull(input({ adapter: bad, runHoldout: async () => { called = true; return []; } }));
  assert.equal(called, false);
  assert.equal(out.value.validation.ok, false);
  assert.equal(out.value.patched, null);
  assert.equal(out.value.patchedDataHash, null);
  assert.equal(out.value.verdict.verdict, 'inconclusive');
  assert.deepEqual(out.value.proposal.changes, []);
});

test('runFull: bad input becomes clear error results, never a throw', async () => {
  assert.equal(code(await runFull(undefined)), 'INVALID_INPUT');
  assert.equal(code(await runFull(input({ baselineResults: [] }))), 'NO_RESULTS');
  assert.equal(code(await runFull(input({ runHoldout: undefined }))), 'INVALID_INPUT');
  assert.equal(code(await runFull(input({ holdoutSeeds: [] }))), 'INVALID_INPUT');
  assert.equal(code(await runFull(input({ holdoutSeeds: [1, 2, 3] }))), 'INVALID_INPUT'); // overlaps baseline
  assert.equal(code(await runFull(input({ runHoldout: async () => { throw new Error('boom'); } }))),
    'SIMULATION_FAILED');
  assert.equal(code(await runFull(input({ runHoldout: async () => [] }))), 'NO_RESULTS');
  assert.equal(code(await runFull(input({ runHoldout: async () => holdoutOf(0.54, 'd'.repeat(64)) }))),
    'DATA_HASH_MISMATCH');
  assert.equal(code(await runFull(input({ runHoldout: async () => pairedResults({ dataHash: PATCHED_HASH,
    seeds: 100 }) }))), 'INVALID_INPUT'); // seeds 1..100 were not requested
  assert.equal(code(await runFull(input({ adapter: {} }))), 'INVALID_INPUT');
});

test('runFull: change labels find the hero through the engine field moveIds', async () => {
  const engineShaped = { ...baseData, characters: [{ id: 'bari', moveIds: ['melee', 'spirit_arrow'] }] };
  const out = await runFull(input({ baseData: engineShaped }));
  assert.equal(out.value.proposal.changes[0].label, 'Bari · Spirit Arrow power');
});

// --- fair matchups: stop after the baseline, no LLM call ---
const fairResults = () => pairedResults({ seeds: 100, winner: (seed) => (seed % 2 ? 'a' : 'b') }); // 50%

test('a fair matchup stops after the baseline: fair, no proposal, no adapter call, no holdout run', async () => {
  let adapterCalled = false;
  let holdoutCalled = false;
  const spy = { async proposeWithOrigin() { adapterCalled = true; throw new Error('must not be called'); },
    async proposePatch() { adapterCalled = true; throw new Error('must not be called'); } };
  const out = await runFull(input({ baselineResults: fairResults(), adapter: spy,
    runHoldout: async () => { holdoutCalled = true; return []; } }));
  assert.equal(out.ok, true, JSON.stringify(out));
  const b = out.value;
  assert.equal(adapterCalled, false);
  assert.equal(holdoutCalled, false);
  assert.equal(b.fair, true);
  assert.equal(b.proposal, null);
  assert.equal(b.validation, null);
  assert.equal(b.patched, null);
  assert.equal(b.patchedDataHash, null);
  assert.deepEqual(b.verdict, { verdict: 'inconclusive',
    reasons: ['no outlier: the matchup is within the fair band'] });
  assert.equal(b.baseline.rows.every((r) => !r.outlier), true);
  assert.equal(b.humanMatches, 0);
  assert.deepEqual(b.evidence.rows, []);
});

test('a flagged matchup still goes through and says fair: false', async () => {
  const out = await runFull(input());
  assert.equal(out.value.fair, false);
  assert.ok(out.value.proposal);
});

test('only a mirror outlier counts as fair (first-seat advantage is not a hero imbalance)', async () => {
  let called = false;
  const mirror = pairedResults({ heroes: ['bari', 'bari'], seeds: 100, winner: () => 'a' });
  const out = await runFull(input({ baselineResults: mirror, adapter: { async proposeWithOrigin() {
    called = true;
    return {};
  } } }));
  assert.equal(out.value.fair, true);
  assert.equal(called, false);
  assert.equal(out.value.baseline.rows[0].outlier, true);
});

test('a fair baseline with a thin sample is fair too (under 30 games there is no outlier)', async () => {
  const out = await runFull(input({ baselineResults: pairedResults({ seeds: 5, winner: () => 'a' }),
    holdoutSeeds: holdoutSeeds.slice(0, 5) }));
  assert.equal(out.value.fair, true);
});

// --- diagnosis: the focus heroes against every other hero, passed to the adapter as context ---
const three = ['bari', 'daewi', 'sepia'];
const diagData = { tuning: { damageScalePermille: 1000 },
  characters: three.map((id) => ({ id, moveIds: [`${id}_melee`, `${id}_shot`] })),
  moves: three.flatMap((id, i) => [{ id: `${id}_melee`, archetype: 'melee', power: 50 },
    { id: `${id}_shot`, archetype: 'projectile', power: i === 0 ? 92 : 90 }]) };
const diagHash = (d) => (d.moves[1].power === 92 ? BASE_HASH : PATCHED_HASH);
const diagBaseline = () => pairedResults({ heroes: ['bari', 'daewi'], seeds: 100, winner: rate(0.99) });
const diagSeeds = Array.from({ length: 100 }, (_, i) => 2000 + i);
const diagStub = (table) => async (matchups, seeds) => matchups.flatMap((dimension) => pairedResults({
  heroes: dimension.split(' vs '), seeds: seeds.length, winner: (s) => (s % 100 < table[dimension] * 100 ? 'a' : 'b') })
  .map((r, i) => ({ ...r, matchId: `${dimension}-${i}`, config: { ...r.config, seed: seeds[r.config.seed - 1] } })));
const diagInput = (extra = {}) => input({ baselineResults: diagBaseline(), baseData: diagData, hashData: diagHash,
  diagnoseSeeds: diagSeeds, runDiagnose: diagStub({ 'bari vs sepia': 0.9, 'daewi vs sepia': 0.5 }),
  runHoldout: async () => holdoutOf(0.9), ...extra });

test('runFull diagnoses the flagged matchup and hands the diagnosis to the adapter as context', async () => {
  let seen;
  const adapter = { async proposeWithOrigin(report, context) {
    seen = context;
    return { origin: 'fake', proposal: { baseDataHash: report.dataHash, rationale: 'x',
      replacements: [{ path: '/moves/1/power', value: 72 }] } };
  } };
  const out = await runFull(diagInput({ adapter }));
  assert.equal(out.ok, true, JSON.stringify(out));
  const d = out.value.diagnosis;
  assert.equal(d.matchup, 'bari vs daewi');
  assert.equal(d.classification, 'overall_strong'); // bari beats daewi and sepia; daewi is fair against sepia
  assert.equal(d.heroes.find((h) => h.hero === 'bari').opponents.length, 2);
  assert.equal(seen.diagnosis, d); // the adapter got the same object
});

test('runFull without runDiagnose has diagnosis: null; a fair baseline never runs the diagnosis', async () => {
  const plain = await runFull(input());
  assert.equal(plain.value.diagnosis, null);
  let called = false;
  const fair = await runFull(diagInput({ baselineResults: fairResults(),
    runDiagnose: async () => { called = true; return []; } }));
  assert.equal(fair.value.fair, true);
  assert.equal(fair.value.diagnosis, null);
  assert.equal(called, false);
});

test('diagnosis seeds must be fresh, a failed run is a coded error, a bad pin is refused', async () => {
  const code = (o) => (o.ok ? 'ok' : o.error.code);
  assert.equal(code(await runFull(diagInput({ diagnoseSeeds: [1, 2, 3] }))), 'INVALID_INPUT'); // baseline seeds
  assert.equal(code(await runFull(diagInput({ diagnoseSeeds: holdoutSeeds }))), 'INVALID_INPUT'); // holdout seeds
  assert.equal(code(await runFull(diagInput({ diagnoseSeeds: undefined }))), 'INVALID_INPUT');
  assert.equal(code(await runFull(diagInput({ runDiagnose: async () => { throw new Error('boom'); } }))),
    'SIMULATION_FAILED');
  const wrongPin = diagStub({ 'bari vs sepia': 0.9, 'daewi vs sepia': 0.5 });
  assert.equal(code(await runFull(diagInput({ runDiagnose: async (m, s) => (await wrongPin(m, s)).map((r) => ({
    ...r, config: { ...r.config, dataHash: 'd'.repeat(64) } })) }))), 'DATA_HASH_MISMATCH');
});

test('a diagnosis that cannot be built does not stop the run: diagnosis null plus diagnosisError', async () => {
  const out = await runFull(diagInput({ baseData: { characters: diagData.characters, tuning: {} },
    hashData: () => BASE_HASH,
    applyPatch: (data) => ({ data, dataHash: PATCHED_HASH }) }));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.value.diagnosis, null);
  assert.ok(out.value.diagnosisError);
});

test('change labels: a unique move names its hero, a shared move lists every hero it changes', async () => {
  const shared = { tuning: {}, characters: [{ id: 'bari', moveIds: ['melee', 'spirit_arrow'] },
    { id: 'daewi', moveIds: ['melee', 'heavy_melee'] }, { id: 'real_armor', moveIds: ['melee'] }],
  moves: [{ id: 'melee', power: 50 }, { id: 'spirit_arrow', power: 92 }, { id: 'heavy_melee', power: 80 }] };
  const labelFor = async (index) => {
    const data = structuredClone(shared);
    const hash = (d) => (d.moves[1].power === 92 && d.moves[0].power === 50 ? BASE_HASH : PATCHED_HASH);
    const out = await runFull(input({ baseData: data, hashData: hash, adapter: { async proposeWithOrigin(report) {
      return { origin: 'fake', proposal: { baseDataHash: report.dataHash, rationale: 'x',
        replacements: [{ path: `/moves/${index}/power`, value: 40 }] } };
    } } }));
    assert.equal(out.ok, true, JSON.stringify(out));
    return out.value.proposal.changes[0].label;
  };
  assert.equal(await labelFor(1), 'Bari · Spirit Arrow power');
  assert.equal(await labelFor(0), 'Melee power (shared: Bari, Daewi, Real Armor)');
});

test('change labels and old values for hero stats come from the character, not from the damage scale', async () => {
  const data = { tuning: { damageScalePermille: 1000 },
    moves: [{ id: 'melee', power: 50 }, { id: 'spirit_arrow', power: 92 }],
    characters: [{ id: 'bari', moveIds: ['melee', 'spirit_arrow'], health: 540, speed: 120 },
      { id: 'real_armor', moveIds: ['melee'], health: 700, speed: 85 }] };
  const hash = (d) => (d.characters[1].speed === 85 ? BASE_HASH : PATCHED_HASH);
  const out = await runFull(input({ baseData: data, hashData: hash, adapter: { async proposeWithOrigin(report) {
    return { origin: 'fake', proposal: { baseDataHash: report.dataHash, rationale: 'x', replacements: [
      { path: '/characters/1/speed', value: 100 }, { path: '/characters/0/health', value: 600 }] } };
  } } }));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.value.proposal.changes, [
    { path: '/characters/1/speed', label: 'Real Armor · Speed', old: 85, new: 100 },
    { path: '/characters/0/health', label: 'Bari · Health', old: 540, new: 600 }]);
});

// --- Gemini: the default model, and a fallback that says why ---
import { createAdapter } from '../src/index.js';
import { DEFAULT_GEMINI_MODEL } from '../src/llm.js';

const geminiReply = (proposal) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{
  text: JSON.stringify(proposal) }] } }] }) });

test('the default Gemini model is the flash-lite alias, and GEMINI_MODEL still overrides it', async () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-flash-lite-latest');
  const urls = [];
  const fetch = async (url) => { urls.push(url); return geminiReply({ baseDataHash: BASE_HASH, rationale: 'model',
    replacements: [{ path: '/moves/1/power', value: 70 }] }); };
  await createAdapter('gemini', { GEMINI_API_KEY: 'k' }, { fetch }).proposeWithOrigin(
    (await runFull(input())).value.baseline);
  await createAdapter('gemini', { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'my-model' }, { fetch })
    .proposeWithOrigin((await runFull(input())).value.baseline);
  assert.match(urls[0], /\/models\/gemini-flash-lite-latest:generateContent$/);
  assert.match(urls[1], /\/models\/my-model:generateContent$/);
});

test('a failing model shows in the response: origin fallback with the reason, never a key or a body', async () => {
  const failures = [
    [async () => ({ ok: false, status: 404, json: async () => ({ error: 'secret body' }) }), /HTTP 404/],
    [async () => { throw new Error('connect ECONNREFUSED'); }, /ECONNREFUSED/],
    [async () => ({ ok: true, json: async () => ({}) }), /empty model response/]];
  for (const [fetch, reason] of failures) {
    const adapter = createAdapter('gemini', { GEMINI_API_KEY: 'super-secret-key' }, { fetch, retries: 0 });
    const out = await runFull(input({ adapter }));
    assert.equal(out.ok, true, JSON.stringify(out));
    const { proposal } = out.value;
    assert.equal(proposal.origin, 'fallback');
    assert.match(proposal.fallbackReason, reason);
    assert.doesNotMatch(JSON.stringify(out.value), /super-secret-key|secret body/);
    assert.ok(proposal.replacements.length > 0); // the offline proposal still goes through validation and the holdout
  }
  const answer = geminiReply({ baseDataHash: BASE_HASH, rationale: 'model',
    replacements: [{ path: '/moves/1/power', value: 70 }] });
  const fine = await runFull(input({ adapter: createAdapter('gemini', { GEMINI_API_KEY: 'k' },
    { fetch: async () => answer }) }));
  assert.equal(fine.value.proposal.origin, 'gemini');
  assert.equal('fallbackReason' in fine.value.proposal, false); // no reason when the model answered
  assert.equal('fallbackReason' in (await runFull(input())).value.proposal, false); // the offline adapter has none
});
