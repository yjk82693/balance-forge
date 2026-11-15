import test from 'node:test';
import assert from 'node:assert/strict';
import { waveTable, flaggedWave, judgeWaves, waveReport, DEFAULT_WAVE_TARGETS } from '../src/waves.ts';
import { runFullWaves } from '../pipeline/full-waves.ts';
import { FakePatchAdapter, validatePatch, buildPrompt } from '../src/index.ts';
import { importEngine } from './engine.ts';

const { data } = await importEngine('packages/games/tentacle/index.ts');
const { hash } = await importEngine('packages/contracts/index.ts');
const { applyPatch } = await importEngine('packages/contracts/index.ts');

// A synthetic run: reaches waves 1..reached, clears the first `cleared` of them; `dies` when it did not clear the last.
function run(seed: number, { reached, cleared, dataHash = hash(data) }:
  { reached: number; cleared: number; dataHash?: string }) {
  const actions = [{ actionId: 'move', opportunities: 1, uses: 1 }];
  for (let w = 1; w <= 6; w++) {
    actions.push({ actionId: `wave:${w}:reached`, opportunities: 0, uses: w <= reached ? 1 : 0 });
    actions.push({ actionId: `wave:${w}:cleared`, opportunities: w <= reached ? 1 : 0, uses: w <= cleared ? 1 : 0 });
    actions.push({ actionId: `wave:${w}:damage`, opportunities: 0, uses: 0 });
  }
  const won = cleared === 6;
  return { matchId: `m-${seed}`, valid: true, errorCode: '', finalStateHash: 'a'.repeat(64),
    config: { contractVersion: '0.1', schemaVersion: 1, gameId: 'tentacle_run', simVersion: 'tentacle-0.1.0', dataHash,
      seed, players: ['p1'], mode: 'realtime', maxTicks: 7200 },
    outcome: { status: won ? 'win' : 'draw', winners: won ? ['p1'] : [], reason: won ? 'boss_down' : 'death' },
    statistics: { players: [{ playerId: 'p1', wins: won ? 1 : 0, draws: won ? 0 : 1, damage: 0, actions }],
      durationTicks: 1000 } };
}
// every run reaches wave 4; `survivors` of `n` clear it and go on to clear everything
const runs = (n: number, survivors: number, offset = 0, dataHash = hash(data)) => Array.from({ length: n }, (_, i) =>
  i < survivors ? run(offset + i + 1, { reached: 6, cleared: 6, dataHash }) :
    run(offset + i + 1, { reached: 4, cleared: 3, dataHash }));

test('waveTable: reach rate, clear rate given reached with a Wilson interval, deaths, flagged wave', () => {
  const table = waveTable(runs(100, 15));
  const w4 = table.waves[3];
  assert.deepEqual([w4.reached, w4.cleared, w4.deaths], [100, 15, 85]);
  assert.equal(w4.clearRate, 0.15);
  assert.ok(w4.ci95[0] < 0.15 && w4.ci95[1] > 0.15);
  assert.equal(w4.target, DEFAULT_WAVE_TARGETS[3]);
  assert.equal(w4.outlier, true);
  assert.equal(table.waves[0].outlier, false);
  assert.equal(table.waves[4].reachRate, 0.15);
  assert.equal(table.winRate, 0.15);
  assert.equal(flaggedWave(table).wave, 4);
  assert.equal(flaggedWave(waveTable(runs(100, 100))), null);
});

test('a thin wave (fewer than 30 reached) is never flagged', () => {
  const table = waveTable(runs(20, 0));
  assert.equal(table.waves[3].outlier, false);
});

test('judgeWaves against the target band: on target, improved, overshot, unchanged, thin', () => {
  const before = waveTable(runs(100, 15)); // wave 4: 15%, target 65%, band 60-70%
  const onTarget = judgeWaves(before, waveTable(runs(100, 65, 1000)));
  assert.equal(onTarget.targets[0].outcome, 'on target');
  assert.deepEqual(onTarget.targets[0].band, [0.6, 0.7]);
  assert.equal(onTarget.verdict, 'accepted');
  const improved = judgeWaves(before, waveTable(runs(100, 40, 1000))); // 40% [31, 50]: toward the band, still below
  assert.equal(improved.targets[0].outcome, 'improved');
  assert.equal(improved.verdict, 'accepted');
  const overshot = judgeWaves(before, waveTable(runs(100, 98, 1000))); // 98%: the whole interval above the band
  assert.equal(overshot.targets[0].outcome, 'overshot');
  assert.equal(overshot.verdict, 'rejected');
  assert.match(overshot.reasons.join(' '), /overshot.*another round or the designer/);
  assert.equal(judgeWaves(before, waveTable(runs(100, 15, 1000))).verdict, 'inconclusive');
  assert.equal(judgeWaves(waveTable(runs(100, 60)), waveTable(runs(100, 60, 1000))).targets.length, 0);
  assert.match(judgeWaves(before, waveTable(runs(10, 10, 1000))).reasons.join(' '), /too thin|needed/);
});

test('a wave that was not flagged and leaves its band upward counts as worse', () => {
  const before = waveTable(runs(100, 15));
  const after = structuredClone(before);
  Object.assign(before.waves[1], { clearRate: 0.7, ci95: [0.6, 0.8], reached: 100 }); // wave 2: inside its band
  Object.assign(after.waves[1], { clearRate: 0.95, ci95: [0.88, 0.98], reached: 100 }); // whole interval above 65-75%
  after.waves[3] = { ...after.waves[3], clearRate: 0.65, ci95: [0.55, 0.74], reached: 100, outlier: false };
  const verdict = judgeWaves(before, after);
  assert.equal(verdict.targets[0].outcome, 'on target'); // the flagged wave itself is fine
  assert.equal(verdict.verdict, 'rejected');
  assert.match(verdict.reasons.join(' '), /section 2: left its band/);
});

test('runFullWaves: baseline, flagged wave, stand-in proposal, holdout, verdict', async () => {
  const baseHash = hash(data);
  const patched = (await importEngine('packages/contracts/index.ts')).applyPatch(data, { baseDataHash: baseHash,
    rationale: 'x', replacements: [{ path: '/gameRules/sections/3/anchorSpacing', value: 3990 }] });
  const out = await runFullWaves({ baselineResults: runs(100, 15), baseData: data, rootData: data, hashData: hash,
    adapter: new FakePatchAdapter({ baseDataHash: '0'.repeat(64), replacements: [], rationale: '' }),
    holdoutSeeds: Array.from({ length: 100 }, (_, i) => 1001 + i), botPolicyVersion: 'tentacle-bot-0.1.0',
    seedSetId: 'runs-1-100', runHoldout: async () => runs(100, 65, 1000, hash(patched)) });
  assert.equal(out.ok, true, JSON.stringify(out));
  const body = out.value;
  assert.equal(body.fair, false);
  assert.equal(body.flaggedWave.wave, 4);
  assert.deepEqual(body.proposal.replacements, [{ path: '/gameRules/sections/3/anchorSpacing', value: 3990 }]);
  assert.equal(body.proposal.changes[0].label, 'Section 4 · Anchor spacing');
  assert.equal(body.proposal.changes[0].old, 9500);
  assert.equal(body.patchedDataHash, hash(patched));
  assert.equal(body.verdict.verdict, 'accepted');
  assert.equal(body.verdict.targets[0].outcome, 'on target');
  const fair = await runFullWaves({ baselineResults: runs(100, 100), baseData: data, rootData: data, hashData: hash,
    adapter: new FakePatchAdapter({ baseDataHash: '0'.repeat(64), replacements: [], rationale: '' }),
    holdoutSeeds: [5000], botPolicyVersion: 'b', seedSetId: 's', runHoldout: async () => [] });
  assert.equal(fair.value.fair, true);
  assert.equal(fair.value.proposal, null);
});

test('the prompt lists wave paths only and both validators agree on wave patches', () => {
  const report = waveReport(waveTable(runs(100, 15)), { dataHash: hash(data), botPolicyVersion: 'b', simVersion: 's',
    seedSetId: 'x' });
  const prompt = buildPrompt(report as any, { rootData: data, flaggedWave: { wave: 4 } });
  assert.match(prompt, /gameRules\/sections\/<N>\/<field>/);
  assert.doesNotMatch(prompt, /characters\/<N>\/health|gameRules\/cards/);
  const proposal = { baseDataHash: hash(data), rationale: 'x', replacements: [{ path: '/gameRules/sections/3/walls',
    value: 2 }] };
  assert.equal(validatePatch(proposal, { rootData: data }).ok, true);
  assert.equal(applyPatch(data, proposal).gameRules.sections[3].walls, 2);
});
