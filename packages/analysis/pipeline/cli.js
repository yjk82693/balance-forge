#!/usr/bin/env node
// Usage:
//   node pipeline/cli.js propose --baseline results.json --out dir [--adapter fake|gemini|grok]
//   node pipeline/cli.js verify  --holdout results.json --out dir   (needs dir/report_baseline.json)
//   node pipeline/cli.js run     --baseline a.json --holdout b.json --out dir
//   node pipeline/cli.js replay  --baseline results.json --patch patch.json --out dir [--base-data data.json]
//                                 -> before_after.json (most lopsided match, same seed, patched data)
// Optional: --metrics runner-metrics.json (elapsedMs, recorded), --human human-results.json (MatchResult[]).
// Writes report_baseline.json, patch.json, report_patched.json, verdict.json (+ pipeline-meta.json).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePhase, proposeStep, verifyStep } from './pipeline.js';
import { createAdapter } from '../src/adapters.js';
import { withExtras } from '../src/extras.js';
import { addHumanRows, humanResultsOf, buildHumanGroup } from '../src/human.js';
import { buildBeforeAfter, matchupResolver, pickLopsidedMatch, resolveDataVariants } from '../src/replay.js';
import { fail, isError, toErrorResult } from '../src/errors.js';
import { assertMatchResults, assertReport } from '../src/input-check.js';
import { loadArenaSimulator } from './arena-simulator.js';
import { buildMatchupTable } from '../src/matchups.js';
import { validatePatch } from '../src/validator.js';

// File errors become coded results; messages name the file, never its contents.
function readJson(p) {
  let text;
  try {
    text = readFileSync(p, 'utf8');
  } catch (e) {
    return fail('IO_ERROR', e?.code === 'ENOENT' ? `file not found: ${p}` : `could not read file: ${p}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return fail('INVALID_JSON', `file is not valid JSON: ${p}`);
  }
}
function writeJson(p, v) {
  try {
    writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
  } catch {
    fail('IO_ERROR', `could not write file: ${p}`);
  }
}
const USAGE = 'usage: cli.js propose|verify|run|replay --out dir [--baseline f] [--holdout f] [--patch f] '
  + '[--adapter fake|gemini|grok] [--metrics f] [--human f] [--roster a,b,c] [--engine-root dir]';
const REQUIRED = { propose: ['baseline', 'out'], verify: ['holdout', 'out'], run: ['baseline', 'holdout', 'out'],
  replay: ['baseline', 'patch', 'out'] };

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) fail('USAGE', `bad argument: ${rest[i]}. ${USAGE}`);
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  return { cmd, flags };
}

function resultsOf(path) {
  const v = readJson(path);
  const list = Array.isArray(v) ? v : v?.results;
  if (!Array.isArray(list)) fail('INVALID_INPUT', `${path} must hold a MatchResult[] (or {results: [...]})`);
  return assertMatchResults(list, path);
}

const withHuman = (report, flags) => (flags.human ? addHumanRows(report, humanResultsOf(readJson(flags.human))) :
  report);

function extrasFrom(flags) {
  const extras = {};
  if (flags['metrics']) {
    const m = readJson(flags['metrics']);
    if (m === null || typeof m !== 'object' || Array.isArray(m)) {
      fail('INVALID_INPUT', `${flags.metrics} must hold a JSON object (runner metrics)`);
    }
    if (Number.isFinite(m.elapsedMs)) extras.elapsedMs = Math.round(m.elapsedMs);
    if (m.kind === 'recorded') extras.recorded = true;
  }
  return extras;
}

/**
 * Never rejects: resolves { ok: true, ...summary } or { ok: false, error: { code, message } }.
 */
export async function main(argv, env = process.env, now = () => new Date().toISOString()) {
  try {
    return { ok: true, ...(await run(argv, env, now)) };
  } catch (e) {
    return toErrorResult(e);
  }
}

async function run(argv, env, now) {
  const { cmd, flags } = parseArgs(Array.isArray(argv) ? argv : []);
  if (!REQUIRED[cmd]) fail('USAGE', USAGE);
  const missing = REQUIRED[cmd].filter((k) => !flags[k]);
  if (missing.length) fail('USAGE', `missing --${missing.join(', --')}. ${USAGE}`);
  try {
    mkdirSync(flags.out, { recursive: true });
  } catch {
    fail('IO_ERROR', `could not create output folder: ${flags.out}`);
  }
  const f = (name) => join(flags.out, name);
  const reportOptions = { botPolicyVersion: flags['bot-policy'], seedSetId: flags['seed-set'] };
  for (const k of Object.keys(reportOptions)) if (reportOptions[k] === undefined) delete reportOptions[k];
  const summary = {};

  if (cmd === 'replay') {
    const loaded = await loadArenaSimulator(flags['engine-root']);
    if (isError(loaded)) fail(loaded.error.code, loaded.error.message);
    const { simulate, hashData, baseData: engineData } = loaded.value;
    const results = resultsOf(flags.baseline);
    const proposal = readJson(flags.patch);
    const patchCheck = validatePatch(proposal);
    if (!patchCheck.ok) fail('INVALID_PATCH', `the patch file is not a valid PatchProposal: ${patchCheck.errors[0]}`,
      patchCheck.errors);
    const baseData = flags['base-data'] ? readJson(flags['base-data']) : engineData;
    const variants = resolveDataVariants(results, baseData, hashData);
    const seatsByHash = new Map([...variants].map(([h, d]) => [h, d.gameRules?.seats ?? []]));
    const pick = pickLopsidedMatch(results, { ...matchupResolver(seatsByHash), dataHash: proposal.baseDataHash });
    if (isError(pick)) fail(pick.error.code, pick.error.message);
    const { result, dimension, matchupWinRate, matchupGames, margin } = pick.value;
    const data = variants.get(result.config.dataHash);
    if (!data) fail('DATA_HASH_MISMATCH', 'no base data explains the picked match dataHash; pass --base-data');
    const out = buildBeforeAfter({
      baselineResult: result, baseData: data, proposal, simulate, hashData,
      selection: { reason: 'most one-sided win in the most lopsided matchup', dimension, matchupWinRate, matchupGames,
        margin },
    });
    if (isError(out)) fail(out.error.code, out.error.message);
    writeJson(f('before_after.json'), out.value);
    return { replay: 'before_after.json', matchId: result.matchId, winnerChanged: out.value.delta.winnerChanged };
  }

  if (cmd === 'propose' || cmd === 'run') {
    const { report, meta, counted } = analyzePhase(resultsOf(flags.baseline), { reportId: 'r-baseline',
      ...reportOptions });
    const baseline = withExtras(withHuman(report, flags), { createdAt: now(), ...extrasFrom(flags) });
    let adapter;
    try {
      adapter = createAdapter(flags.adapter ?? 'fake', env);
    } catch {
      fail('USAGE', `unknown adapter: ${flags.adapter}. Use fake, gemini or grok`);
    }
    const step = await proposeStep(baseline, adapter);
    writeJson(f('report_baseline.json'), baseline);
    if (flags.human) {
      const hg = buildHumanGroup(humanResultsOf(readJson(flags.human)));
      if (isError(hg)) fail(hg.error.code, hg.error.message);
      writeJson(f('human_group.json'), hg.value);
    }
    if (step.ok) writeJson(f('patch.json'), step.proposal);
    const table = buildMatchupTable(counted, flags.roster ? { roster: flags.roster.split(',') } : {});
    if (table.ok) writeJson(f('matchup_table.json'), table.value);
    writeJson(f('pipeline-meta.json'), { patchOrigin: step.origin, fallbackReason: step.fallbackReason,
      patchValid: step.ok, patchErrors: step.errors, baseline: meta });
    Object.assign(summary, { patchOrigin: step.origin, fallbackReason: step.fallbackReason, patchValid: step.ok,
      patchErrors: step.errors });
  }
  if (cmd === 'verify' || cmd === 'run') {
    const baseline = assertReport(readJson(f('report_baseline.json')), 'report_baseline.json');
    const prior = existsSync(f('pipeline-meta.json')) ? readJson(f('pipeline-meta.json')) : {};
    const out = verifyStep(baseline, resultsOf(flags.holdout), { reportId: 'r-patched',
      botPolicyVersion: baseline.botPolicyVersion, seedSetId: baseline.seedSetId, ...reportOptions });
    writeJson(f('report_patched.json'), withExtras(withHuman(out.report, flags),
      { createdAt: now(), ...extrasFrom(flags) }));
    writeJson(f('verdict.json'), { ...out.verdict, patchOrigin: prior.patchOrigin ?? 'unknown', holdout: out.meta });
    writeJson(f('pipeline-meta.json'), { ...prior, holdout: out.meta });
    summary.verdict = out.verdict.verdict;
  }
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = (r) => {
    if (r.ok) console.log(JSON.stringify(r));
    else { console.error(JSON.stringify(r)); process.exitCode = 1; }
  };
  // Last line of defence: anything unexpected still ends as a clear error result.
  process.on('uncaughtException', (e) => { report(toErrorResult(e)); process.exit(1); });
  process.on('unhandledRejection', (e) => { report(toErrorResult(e)); process.exit(1); });
  main(process.argv.slice(2)).then(report);
}
