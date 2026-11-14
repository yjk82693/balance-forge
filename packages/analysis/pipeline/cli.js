#!/usr/bin/env node
// Usage:
//   node pipeline/cli.js propose --baseline results.json --out dir [--adapter fake|gemini|grok]
//   node pipeline/cli.js verify  --holdout results.json --out dir   (needs dir/report_baseline.json)
//   node pipeline/cli.js run     --baseline a.json --holdout b.json --out dir
// Optional: --metrics runner-metrics.json (elapsedMs, recorded), --human human-results.json (MatchResult[]).
// Writes report_baseline.json, patch.json, report_patched.json, verdict.json (+ pipeline-meta.json).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePhase, proposeStep, verifyStep } from './pipeline.js';
import { createAdapter } from '../src/adapters.js';
import { withExtras } from '../src/extras.js';
import { addHumanRows, humanResultsOf } from '../src/human.js';

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
  if (!flags.out || !['propose', 'verify', 'run'].includes(cmd)) {
    throw new Error('usage: cli.js propose|verify|run --out dir [--baseline f] [--holdout f] [--adapter fake|gemini|grok] [--metrics f]');
  }
  mkdirSync(flags.out, { recursive: true });
  const f = (name) => join(flags.out, name);
  const reportOptions = { botPolicyVersion: flags['bot-policy'], seedSetId: flags['seed-set'] };
  for (const k of Object.keys(reportOptions)) if (reportOptions[k] === undefined) delete reportOptions[k];
  const summary = {};

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
