// Measurement for the live path: runs `runFull` against the real engine runner (in this process, no server, no
// network) with the fake adapter, and prints one JSON line:
//   node packages/analysis/pipeline/measure-full.js --mode nonroster|roster --pairs 100 [--engine-root dir]
// Reports: baseline and holdout win rate of Bari vs Real Armor, the proposal, the verdict and elapsed time.
// Prepared only; it has not been run against scripted-0.2.1 recordings (see REPORT "Round 7").
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createAdapter } from '../src/adapters.ts';
import { errorResult, isError, toErrorResult } from '../src/errors.ts';
import { runFull } from './full.ts';

const TARGET_ROW = 'bari vs real_armor';
const HOLDOUT_FIRST_SEED = 1000001; // same as the room service: far from baseline seeds 1..pairs

function parse(argv) {
  const flags = { mode: 'nonroster', pairs: '100' };
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument: ${argv[i]}`);
    flags[argv[i].slice(2)] = argv[i + 1];
  }
  const pairs = Number(flags.pairs);
  if (!['nonroster', 'roster'].includes(flags.mode) || !Number.isInteger(pairs) || pairs < 1 || pairs > 1000) {
    throw new Error('usage: --mode nonroster|roster --pairs 1..1000 [--engine-root dir]');
  }
  return { mode: flags.mode, pairs, engineRoot: flags['engine-root'] };
}

const rowOf = (report) => {
  const row = report?.rows.find((r) => r.dimension === TARGET_ROW);
  return row ? { winRate: row.winRate, games: row.games, ci95: row.ci95, outlier: row.outlier } : null;
};

/** Runs the measurement; resolves { ok: true, value } or an error result. Never rejects. */
export async function measureFull({ mode = 'nonroster', pairs = 100, engineRoot, env = {} }: any = {}) {
  try {
    const load = (rel) => import(engineRoot ? pathToFileURL(join(resolve(engineRoot), rel)).href
      : new URL(`../../../${rel}`, import.meta.url).href);
    const [runner, arena, contracts, bot] = await Promise.all([load('services/runner/index.ts'),
      load('packages/games/action/index.ts'), load('packages/contracts/index.ts'),
      load('packages/games/action/bot.ts')]);
    const jobsFor = mode === 'roster' ? runner.rosterJobs : runner.pairedJobs;
    const phases = {};
    const runPhase = (name) => async (data, seeds) => {
      const start = performance.now();
      const batch = await runner.runBatch(jobsFor({ data, seeds }), { workers: 2 });
      phases[name] = { matches: batch.results.length, ms: Math.round(performance.now() - start) };
      return batch.results;
    };
    const seeds = Array.from({ length: pairs }, (_, i) => i + 1);
    const holdoutSeeds = Array.from({ length: pairs }, (_, i) => HOLDOUT_FIRST_SEED + i);
    const start = performance.now();
    const baselineResults = await runPhase('baseline')(arena.data, seeds);
    const out = await runFull({ baselineResults, baseData: arena.data, adapter: createAdapter('fake', env),
      hashData: contracts.hash, holdoutSeeds, runHoldout: runPhase('holdout'),
      botPolicyVersion: bot.botPolicyVersion, seedSetId: `paired-1-${pairs}`,
      holdoutSeedSetId: `holdout-${HOLDOUT_FIRST_SEED}-${HOLDOUT_FIRST_SEED + pairs - 1}` });
    if (isError(out)) return out;
    const body = out.value;
    return { ok: true, value: { mode, pairs, botPolicyVersion: bot.botPolicyVersion, fair: body.fair,
      baseline: rowOf(body.baseline), holdout: rowOf(body.patched), proposal: body.proposal,
      validation: body.validation, verdict: body.verdict, phases, elapsedMs: Math.round(performance.now() - start) } };
  } catch (e) {
    return e?.code === 'ERR_MODULE_NOT_FOUND' ? errorResult('ENGINE_UNAVAILABLE', 'engine modules not found; '
      + 'pass --engine-root') : toErrorResult(e);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = await measureFull({ ...parse(process.argv.slice(2)) });
  } catch (e) {
    result = errorResult('USAGE', String(e.message));
  }
  (result.ok ? console.log : console.error)(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
