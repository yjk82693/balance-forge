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
import { addHumanRows, humanResultsOf } from '../src/human.js';
import { buildBeforeAfter, matchupResolver, pickLopsidedMatch, resolveDataVariants } from '../src/replay.js';
import { fail, isError } from '../src/errors.js';
import { loadArenaSimulator } from './arena-simulator.js';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error(`bad argument: ${rest[i]}`);
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  return { cmd, flags };
}

function resultsOf(path) {
  const v = readJson(path);
  return Array.isArray(v) ? v : v.results;
}

const withHuman = (report, flags) => (flags.human ? addHumanRows(report, humanResultsOf(readJson(flags.human))) : report);

function extrasFrom(flags) {
  const extras = {};
  if (flags['metrics']) {
    const m = readJson(flags['metrics']);
    if (Number.isFinite(m.elapsedMs)) extras.elapsedMs = Math.round(m.elapsedMs);
    if (m.kind === 'recorded') extras.recorded = true;
  }
  return extras;
}

export async function main(argv, env = process.env, now = () => new Date().toISOString()) {
  const { cmd, flags } = parseArgs(argv);
  if (!flags.out || !['propose', 'verify', 'run', 'replay'].includes(cmd)) {
    throw new Error('usage: cli.js propose|verify|run|replay --out dir [--baseline f] [--holdout f] [--adapter fake|gemini|grok] [--metrics f]');
  }
  mkdirSync(flags.out, { recursive: true });
  const f = (name) => join(flags.out, name);
  const reportOptions = { botPolicyVersion: flags['bot-policy'], seedSetId: flags['seed-set'] };
  for (const k of Object.keys(reportOptions)) if (reportOptions[k] === undefined) delete reportOptions[k];
  const summary = {};

  if (cmd === 'replay') {
    const loaded = await loadArenaSimulator();
    if (isError(loaded)) fail(loaded.error.code, loaded.error.message);
    const { simulate, hashData, baseData: engineData } = loaded.value;
    const results = resultsOf(flags.baseline);
    const proposal = readJson(flags.patch);
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
      selection: { reason: 'most one-sided win in the most lopsided matchup', dimension, matchupWinRate, matchupGames, margin },
    });
    if (isError(out)) fail(out.error.code, out.error.message);
    writeJson(f('before_after.json'), out.value);
    return { replay: 'before_after.json', matchId: result.matchId, winnerChanged: out.value.delta.winnerChanged };
  }

  if (cmd === 'propose' || cmd === 'run') {
    const { report, meta } = analyzePhase(resultsOf(flags.baseline), { reportId: 'r-baseline', ...reportOptions });
    const baseline = withExtras(withHuman(report, flags), { createdAt: now(), ...extrasFrom(flags) });
    const adapter = createAdapter(flags.adapter ?? 'fake', env);
    const step = await proposeStep(baseline, adapter);
    writeJson(f('report_baseline.json'), baseline);
    writeJson(f('patch.json'), step.proposal);
    writeJson(f('pipeline-meta.json'), { patchOrigin: step.origin, fallbackReason: step.fallbackReason, patchValid: step.ok, patchErrors: step.errors, baseline: meta });
    Object.assign(summary, { patchOrigin: step.origin, fallbackReason: step.fallbackReason, patchValid: step.ok, patchErrors: step.errors });
  }
  if (cmd === 'verify' || cmd === 'run') {
    const baseline = readJson(f('report_baseline.json'));
    const prior = existsSync(f('pipeline-meta.json')) ? readJson(f('pipeline-meta.json')) : {};
    const out = verifyStep(baseline, resultsOf(flags.holdout), { reportId: 'r-patched', botPolicyVersion: baseline.botPolicyVersion, seedSetId: baseline.seedSetId, ...reportOptions });
    writeJson(f('report_patched.json'), withExtras(withHuman(out.report, flags), { createdAt: now(), ...extrasFrom(flags) }));
    writeJson(f('verdict.json'), { ...out.verdict, patchOrigin: prior.patchOrigin ?? 'unknown', holdout: out.meta });
    writeJson(f('pipeline-meta.json'), { ...prior, holdout: out.meta });
    summary.verdict = out.verdict.verdict;
  }
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (s) => console.log(JSON.stringify(s)),
    (e) => { console.error(`error: ${e.message}`); process.exitCode = 1; },
  );
}
