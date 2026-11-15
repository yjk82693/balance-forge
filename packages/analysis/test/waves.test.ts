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

test('judgeWaves: improved, worse and thin holdouts', () => {
  const before = waveTable(runs(100, 15));
  const better = judgeWaves(before, waveTable(runs(100, 85, 1000)));
  assert.equal(better.verdict, 'accepted');
  assert.equal(better.targets[0].outcome, 'improved');
  assert.equal(better.targets[0].matchup, 'wave 4');
  assert.equal(judgeWaves(before, waveTable(runs(100, 15, 1000))).verdict, 'inconclusive');
  assert.equal(judgeWaves(waveTable(runs(100, 60)), waveTable(runs(100, 60, 1000))).targets.length, 0);
  assert.match(judgeWaves(before, waveTable(runs(10, 10, 1000))).reasons.join(' '), /too thin|needed/);
});

test('runFullWaves: baseline, flagged wave, stand-in proposal, holdout, verdict', async () => {
  const baseHash = hash(data);
  const patched = (await importEngine('packages/contracts/index.ts')).applyPatch(data, { baseDataHash: baseHash,
    rationale: 'x', replacements: [{ path: '/gameRules/waves/3/enemyDamage', value: 20 },
      { path: '/gameRules/waves/3/fireIntervalTicks', value: 60 }] });
  const out = await runFullWaves({ baselineResults: runs(100, 15), baseData: data, rootData: data, hashData: hash,
    adapter: new FakePatchAdapter({ baseDataHash: '0'.repeat(64), replacements: [], rationale: '' }),
    holdoutSeeds: Array.from({ length: 100 }, (_, i) => 1001 + i), botPolicyVersion: 'tentacle-bot-0.1.0',
    seedSetId: 'runs-1-100', runHoldout: async () => runs(100, 80, 1000, hash(patched)) });
  assert.equal(out.ok, true, JSON.stringify(out));
  const body = out.value;
  assert.equal(body.fair, false);
  assert.equal(body.flaggedWave.wave, 4);
  assert.deepEqual(body.proposal.replacements, [{ path: '/gameRules/waves/3/enemyDamage', value: 20 },
    { path: '/gameRules/waves/3/fireIntervalTicks', value: 60 }]);
  assert.equal(body.proposal.changes[0].label, 'Wave 4 · Enemy damage');
  assert.equal(body.proposal.changes[0].old, 40);
  assert.equal(body.patchedDataHash, hash(patched));
  assert.equal(body.verdict.verdict, 'accepted');
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
  assert.match(prompt, /gameRules\/waves\/<N>\/<field>/);
  assert.doesNotMatch(prompt, /characters\/<N>\/health|gameRules\/cards/);
  const proposal = { baseDataHash: hash(data), rationale: 'x', replacements: [{ path: '/gameRules/waves/3/sentries',
    value: 2 }] };
  assert.equal(validatePatch(proposal, { rootData: data }).ok, true);
  assert.equal(applyPatch(data, proposal).gameRules.waves[3].sentries, 2);
});
