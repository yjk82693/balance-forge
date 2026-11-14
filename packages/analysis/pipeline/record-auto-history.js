// Produces a recorded auto-balance history in the shape of services/room/data/versions/<gameId>.json (an array of
// version records, base first) from the real engine runner with an offline adapter. In-process: no server, no network.
//   node packages/analysis/pipeline/record-auto-history.js --out history.json [--rounds 3] [--engine-root dir]
// It writes only the file named by --out and prints one JSON summary line. Run it once the room routes exist, then
// compare with what POST /v1/playtest/auto stores. Generated data is not committed by this script.
//
// Offline adapter (origin "fake"): the plain fake adapter proposes one fixed patch, so a second round would be a no-op.
// This stand-in is deterministic and also offline: for the focus hero of a round it lowers (if winning) or raises (if
// losing) the hero's most-used attack by 20%. It is a placeholder for a model, not a balance method.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baseVersionRecord, focusTargets, runAuto, MAX_ROUNDS } from './auto.js';
import { errorResult, toErrorResult } from '../src/errors.js';

const SEEDS_PER_PHASE = 100;
const LOWER_PERMILLE = 800;
const RAISE_PERMILLE = 1200;
const MAX_POWER = 10000;

/** Same seed plan as the room service: 200 seeds per round, scan first, then holdout. */
export const seedsFor = (round, phase) => Array.from({ length: SEEDS_PER_PHASE }, (_, i) => (round - 1) * 200 +
  (phase === 'holdout' ? SEEDS_PER_PHASE : 0) + i + 1);

export const matchupsOf = (data) => {
  const roster = data.characters.map((c) => c.id).sort();
  return roster.flatMap((hero, i) => roster.slice(i).map((other) => `${hero} vs ${other}`));
};

const ATTACKS = ['melee', 'projectile'];

/** Applies a diagnosis recommendation: its path, its direction and its size in percent of the current value. */
function followRecommendation(report, data, rec, rootData = data) {
  if (!rec) return null;
  const move = /^\/moves\/(\d+)\/power$/.exec(rec.path);
  const stat = /^\/characters\/(\d+)\/(health|speed)$/.exec(rec.path);
  if (!move && !stat) return null; // only a move's power or a hero stat is a lever (no global scaling)
  const current = move ? data.moves[Number(move[1])]?.power : data.characters[Number(stat[1])]?.[stat[2]];
  if (!Number.isInteger(current)) return null;
  const factor = 100 + (rec.direction === 'up' ? rec.sizePct : -rec.sizePct);
  let value = Math.round((current * factor) / 100);
  if (move) value = Math.min(MAX_POWER, Math.max(0, value));
  else {
    const [low, high] = stat[2] === 'health' ? [100, 3000] : [30, 400];
    const root = rootData.characters[Number(stat[1])][stat[2]];
    value = Math.min(high, Math.floor((root * 14) / 10), Math.max(low, Math.ceil((root * 6) / 10), value));
  }
  return { origin: 'fake', proposal: { baseDataHash: report.dataHash, replacements: [{ path: rec.path, value }],
    rationale: `Offline stand-in follows the first recommendation (${rec.direction} ${rec.sizePct}%): ${rec.why}` } };
}

/**
 * Offline stand-in adapter (origin "fake"): follows the diagnosis context when there is one (first recommendation).
 * Without it: the focus hero is the one in the most flagged matchups of the report. If it is winning (over those
 * matchups) its most-used attack loses 20% power; if it is losing it gains 20%.
 * `dataOf(hash)` gives the data a report was measured on; `usesOf(hero)` gives { actionId: uses } counted so far.
 */
export function steppingAdapter(dataOf, usesOf = () => ({})) {
  return { async proposeWithOrigin(report, context = {}) {
    const data = dataOf(report.dataHash);
    const followed = followRecommendation(report, data, context.diagnosis?.recommendations?.[0], context.rootData);
    if (followed) return followed;
    const rows = report.rows.filter((r) => r.outlier && !/^(\S+) vs \1$/.test(r.dimension));
    const dimensions = focusTargets(rows.map((r) => r.dimension));
    const heroId = focusHeroOf(dimensions);
    const mine = rows.filter((r) => dimensions.includes(r.dimension));
    const games = mine.reduce((n, r) => n + r.games, 0);
    const winRate = mine.reduce((n, r) => n + r.games * (r.dimension.split(' vs ')[0] === heroId ? r.winRate
      : 1 - r.winRate), 0) / games;
    const hero = data.characters.find((c) => c.id === heroId);
    const uses = usesOf(heroId);
    const action = [...ATTACKS].sort((x, y) => (uses[y] ?? 0) - (uses[x] ?? 0) || (x < y ? -1 : 1))[0];
    const move = data.moves.find((m) => hero.moveIds.includes(m.id) && m.archetype === action)
      ?? data.moves.find((m) => hero.moveIds.includes(m.id) && ATTACKS.includes(m.archetype));
    const index = data.moves.indexOf(move);
    const winning = winRate >= 0.5;
    const factor = winning ? LOWER_PERMILLE : RAISE_PERMILLE;
    const value = Math.min(MAX_POWER, Math.max(1, Math.floor((move.power * factor) / 1000)));
    return { origin: 'fake', proposal: { baseDataHash: report.dataHash, replacements: [{ path:
      `/moves/${index}/power`, value }], rationale: `Offline stand-in: ${winning ? 'lower' : 'raise'} ${move.id} of `
      + `${hero.id} by 20% (${hero.id} is ${winning ? 'winning' : 'losing'}; its most-used attack is ${action}).` } };
  } };
}

/** The hero that appears in every dimension of a focus set (the focus hero); alphabetical if several do. */
function focusHeroOf(dimensions) {
  const counts = new Map();
  for (const d of dimensions) for (const h of d.split(' vs ')) counts.set(h, (counts.get(h) ?? 0) + 1);
  return [...counts.keys()].sort((x, y) => counts.get(y) - counts.get(x) || (x < y ? -1 : 1))[0];
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
    const usage = {}; // hero -> actionId -> uses, counted over every match run so far (what the stand-in "saw")
    const count = (results) => {
      for (const r of results) {
        for (const p of r.statistics.players) {
          const hero = r.config.options.assignments[p.playerId];
          usage[hero] ??= {};
          for (const a of p.actions) usage[hero][a.actionId] = (usage[hero][a.actionId] ?? 0) + a.uses;
        }
      }
    };
    const result = await runAuto({ gameId: arena.data.gameId, fromHash, data: structuredClone(arena.data), rounds,
      requireApproval: false, hashData: contracts.hash,
      adapter: steppingAdapter((hash) => versions.get(hash), (hero) => usage[hero] ?? {}),
      allMatchups: matchupsOf(arena.data), seedsFor, botPolicyVersion: match.botPolicyVersion, now,
      applyPatch: (base, proposal) => {
        const data = applyEngine(base, proposal, arena.data);
        return { data, dataHash: keep(data) };
      },
      runBatch: async (dataHash, matchups, seeds) => {
        const jobs = matchups.flatMap((m) => runner.pairedJobs({ data: versions.get(dataHash), seeds,
          heroes: m.split(' vs ') }));
        jobs.forEach((job, i) => { job.matchId = `m-${i + 1}`; });
        const results = (await runner.runBatch(jobs, { workers: 2 })).results;
        count(results);
        return results;
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
