// Produces a recorded auto-balance history in the shape of services/room/data/versions/<gameId>.json (an array of
// version records, base first) from the real engine runner with an offline adapter. In-process: no server, no network.
//   node packages/analysis/pipeline/record-auto-history.js --out history.json [--rounds 3] [--engine-root dir]
// It writes only the file named by --out and prints one JSON summary line. Run it once the room routes exist, then
// compare with what POST /v1/playtest/auto stores. Generated data is not committed by this script.
//
// Offline adapter (origin "fake"): the plain fake adapter proposes one fixed patch, so a second round would be a no-op.
// This stand-in is deterministic and also offline: it lowers the second move of the hero that wins the most lopsided
// flagged matchup by 20%. It is a placeholder for a model, not a balance method.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baseVersionRecord, runAuto, MAX_ROUNDS } from './auto.js';
import { errorResult, toErrorResult } from '../src/errors.js';

const SEEDS_PER_PHASE = 100;
const POWER_FACTOR_PERMILLE = 800;

/** Same seed plan as the room service: 200 seeds per round, scan first, then holdout. */
export const seedsFor = (round, phase) => Array.from({ length: SEEDS_PER_PHASE }, (_, i) => (round - 1) * 200 +
  (phase === 'holdout' ? SEEDS_PER_PHASE : 0) + i + 1);

export const matchupsOf = (data) => {
  const roster = data.characters.map((c) => c.id).sort();
  return roster.flatMap((hero, i) => roster.slice(i).map((other) => `${hero} vs ${other}`));
};

/** Offline stand-in adapter; `dataOf(hash)` gives the data a report was measured on. */
export function steppingAdapter(dataOf) {
  return { async proposeWithOrigin(report) {
    const data = dataOf(report.dataHash);
    const row = report.rows.filter((r) => r.outlier && !/^(\S+) vs \1$/.test(r.dimension))
      .sort((a, b) => Math.abs(b.winRate - 0.5) - Math.abs(a.winRate - 0.5) || (a.dimension < b.dimension ? -1 : 1))[0]
      ?? report.rows[0];
    const [first, second] = row.dimension.split(' vs ');
    const hero = data.characters.find((c) => c.id === (row.winRate >= 0.5 ? first : second));
    const moveId = hero.moveIds[1] ?? hero.moveIds[0];
    const index = data.moves.findIndex((m) => m.id === moveId);
    const value = Math.max(1, Math.floor((data.moves[index].power * POWER_FACTOR_PERMILLE) / 1000));
    return { origin: 'fake', proposal: { baseDataHash: report.dataHash, replacements: [{ path:
      `/moves/${index}/power`, value }], rationale: `Offline stand-in: lower ${moveId} of ${hero.id} by 20%.` } };
  } };
}

function parse(argv) {
  const flags = { rounds: '3' };
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument: ${argv[i]}`);
    flags[argv[i].slice(2)] = argv[i + 1];
  }
  const rounds = Number(flags.rounds);
  if (!flags.out || !Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    throw new Error(`usage: --out file.json [--rounds 1..${MAX_ROUNDS}] [--engine-root dir]`);
  }
  return { out: flags.out, rounds, engineRoot: flags['engine-root'] };
}

/** Runs the history; resolves { ok: true, value: { records, stoppedBecause, ... } } or an error result. */
export async function recordAutoHistory({ rounds = 3, engineRoot, now = () => new Date().toISOString() } = {}) {
  try {
    const load = (rel) => import(engineRoot ? pathToFileURL(join(resolve(engineRoot), rel)).href
      : new URL(`../../../${rel}`, import.meta.url).href);
    const [runner, arena, contracts, match] = await Promise.all([load('services/runner/index.js'),
      load('packages/games/action/index.js'), load('packages/contracts/index.js'),
      load('services/runner/match.js')]);
    const applyEngine = contracts.applyPatch ?? (await load('packages/contracts/semantics.js')).applyPatch;
    const versions = new Map();
    const keep = (data) => { const dataHash = contracts.hash(data); versions.set(dataHash, data); return dataHash; };
    const fromHash = keep(arena.data);
    const result = await runAuto({ gameId: arena.data.gameId, fromHash, data: structuredClone(arena.data), rounds,
      requireApproval: false, adapter: steppingAdapter((hash) => versions.get(hash)), hashData: contracts.hash,
      allMatchups: matchupsOf(arena.data), seedsFor, botPolicyVersion: match.botPolicyVersion, now,
      applyPatch: (base, proposal) => {
        const data = applyEngine(base, proposal);
        return { data, dataHash: keep(data) };
      },
      runBatch: async (dataHash, matchups, seeds) => {
        const jobs = matchups.flatMap((m) => runner.pairedJobs({ data: versions.get(dataHash), seeds,
          heroes: m.split(' vs ') }));
        jobs.forEach((job, i) => { job.matchId = `m-${i + 1}`; });
        return (await runner.runBatch(jobs, { workers: 2 })).results;
      } });
    if (result.stoppedBecause === 'error') return errorResult(result.error?.code ?? 'INTERNAL',
      result.error?.message ?? 'the run failed');
    const base = baseVersionRecord({ gameId: arena.data.gameId, dataHash: fromHash, createdAt: now() });
    const history = [{ ...base, rationale: 'Original game data.' }, ...result.records];
    return { ok: true, value: { ...result, history } };
  } catch (e) {
    return e?.code === 'ERR_MODULE_NOT_FOUND' ? errorResult('ENGINE_UNAVAILABLE', 'engine modules not found; '
      + 'pass --engine-root') : toErrorResult(e);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result;
  try {
    const args = parse(process.argv.slice(2));
    result = await recordAutoHistory({ rounds: args.rounds, engineRoot: args.engineRoot });
    if (result.ok) writeFileSync(args.out, `${JSON.stringify(result.value.history, null, 2)}\n`);
  } catch (e) {
    result = errorResult('USAGE', String(e.message));
  }
  const line = result.ok ? { ok: true, stoppedBecause: result.value.stoppedBecause,
    records: result.value.records.length, headHash: result.value.headHash } : result;
  (result.ok ? console.log : console.error)(JSON.stringify(line));
  process.exit(result.ok ? 0 : 1);
}
