// Structural checks for data that crosses a boundary (files, network, other packages).
// They report what is wrong in plain words (max a few issues) and never echo input contents.
import { fail } from './errors.ts';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isSafeInteger(v);
const MAX_ISSUES = 5;

export function matchResultIssues(r) {
  const out = [];
  if (!isObj(r)) return ['not an object'];
  if (typeof r.matchId !== 'string') out.push('matchId must be a string');
  if (typeof r.valid !== 'boolean') out.push('valid must be a boolean');
  const c = r.config;
  if (!isObj(c)) out.push('config missing');
  else {
    if (typeof c.dataHash !== 'string' || c.dataHash === '') out.push('config.dataHash must be a non-empty string');
    if (typeof c.gameId !== 'string') out.push('config.gameId must be a string');
    if (typeof c.simVersion !== 'string') out.push('config.simVersion must be a string');
    if (!isInt(c.seed)) out.push('config.seed must be an integer');
    if (!Array.isArray(c.players) || c.players.length === 0 ||
      c.players.some((p) => typeof p !== 'string')) out.push('config.players must be a non-empty array of strings');
  }
  const o = r.outcome;
  if (!isObj(o) || !['running', 'win', 'draw'].includes(o.status) ||
    !Array.isArray(o.winners)) out.push('outcome must have status running|win|draw and winners[]');
  const s = r.statistics;
  if (!isObj(s) || !Array.isArray(s.players)) out.push('statistics.players must be an array');
  else if (s.players.some((p) => !isObj(p) || typeof p.playerId !== 'string' ||
    !Array.isArray(p.actions))) out.push('statistics.players[] needs playerId and actions[]');
  return out;
}

/** Throws AnalysisError INVALID_INPUT listing the first problems; no input values are quoted. */
export function assertMatchResults(results, label = 'results') {
  if (!Array.isArray(results)) fail('INVALID_INPUT', `${label} must be an array of MatchResult`);
  const problems = [];
  for (let i = 0; i < results.length && problems.length < MAX_ISSUES; i++) {
    for (const issue of matchResultIssues(results[i])) {
      if (problems.length < MAX_ISSUES) problems.push(`${label}[${i}]: ${issue}`);
    }
  }
  if (problems.length) fail('INVALID_INPUT', `malformed MatchResult: ${problems[0]}`, problems);
  return results;
}

export function reportIssues(r) {
  const out = [];
  if (!isObj(r)) return ['not an object'];
  for (const k of ['gameId', 'simVersion', 'dataHash', 'botPolicyVersion',
    'seedSetId']) if (typeof r[k] !== 'string') out.push(`${k} must be a string`);
  for (const k of ['validMatches', 'invalidMatches', 'draws']) if (!isInt(r[k]) ||
    r[k] < 0) out.push(`${k} must be a non-negative integer`);
  if (!Array.isArray(r.rows)) out.push('rows must be an array');
  else {
    r.rows.forEach((row, i) => {
      const bad = !isObj(row) || typeof row.dimension !== 'string' || !isInt(row.wins) || !isInt(row.games) ||
        row.wins > row.games
        || typeof row.winRate !== 'number' || !Number.isFinite(row.winRate) || row.winRate < 0 || row.winRate > 1
        || !Array.isArray(row.ci95) || row.ci95.length !== 2 || row.ci95.some((x) => typeof x !== 'number' ||
          !Number.isFinite(x))
        || typeof row.outlier !== 'boolean';
      if (bad && out.length < MAX_ISSUES) out.push(`rows[${i}] is malformed`);
    });
  }
  return out;
}

export function assertReport(report, label = 'report') {
  const problems = reportIssues(report).slice(0, MAX_ISSUES);
  if (problems.length) fail('INVALID_REPORT', `${label} is malformed: ${problems[0]}`,
    problems.map((p) => `${label}: ${p}`));
  return report;
}
