import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { availableParallelism } from 'node:os';
import { validate } from '../../packages/contracts/index.ts';
import { scriptedVersionOf } from './match.ts';
import type { MatchJob } from './match.ts';
import { learnedBot } from './learn/load.ts';
export { pairedJobs, runMatch, rosterJobs, botPolicies } from './match.ts';
function addMatch(groups, result) {
  const names = result.config.players.map(id => result.config.options?.assignments[id] ?? id).sort();
  const key = JSON.stringify(names);
  if (!groups.has(key)) groups.set(key, {
    matchup: names.join(' vs '),
    heroes: names,
    wins: Object.fromEntries(names.map(id => [id, 0])),
    games: 0,
    seatWins: 0,
    draws: 0,
    invalidMatches: 0
  });
  const row = groups.get(key);
  if (!result.valid) {
    row.invalidMatches++;
    return;
  }
  row.games++;
  if (result.outcome.winners.includes(result.config.players[0])) row.seatWins++;
  if (result.outcome.status === 'draw') row.draws++;
  for (const winner of result.outcome.winners) row.wins[result.config.options?.assignments[winner] ?? winner]++;
}
export type BatchOptions = { workers?: number; captureReplays?: boolean; onProgress?: (progress: any) => unknown };
export async function runBatch(jobs: MatchJob[], {
  workers = Math.min(4, availableParallelism()),
  captureReplays = false,
  onProgress
}: BatchOptions = {}) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 64 || !Array.isArray(jobs) || !jobs.length) throw Error(
    'INVALID_SCHEMA');
  if (typeof onProgress !== 'undefined' && typeof onProgress !== 'function') throw Error('INVALID_SCHEMA');
  for (const job of jobs) {
    if (!job || typeof job !== 'object') throw Error('INVALID_SCHEMA');
    validate('MatchConfig', job.config);
  }
  const count = Math.min(workers, jobs.length),
    chunks = Array.from({
      length: count
    }, () => []),
    pool = [];
  const rows = new Map(),
    groups = new Map();
  jobs.forEach((job, index) => chunks[index % count].push({
    index,
    job
  }));
  const start = performance.now();
  const report = () => {
    if (!onProgress) return;
    const progress = {
      matchesDone: rows.size,
      totalMatches: jobs.length,
      seatWins: [...groups.values()].reduce((count, row) => count + row.seatWins, 0),
      elapsedMs: Math.round(performance.now() - start),
      matchups: [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => structuredClone(
        row))
    };
    // Observers cannot change final match outcomes or crash worker cleanup.
    try {
      const pending = onProgress(progress);
      pending?.catch?.(() => {});
    } catch {}
  };
  report();
  const timer = onProgress ? setInterval(report, 100) : null;
  try {
    await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        workerData: {
          jobs: chunk,
          captureReplays
        }
      });
      pool.push(worker);
      let received = false;
      const expected = new Set(chunk.map(x => x.index));
      worker.on('message', message => {
        try {
          if (message.type === 'result') {
            const row = message.row;
            if (!expected.delete(row.index) || rows.has(row.index)) throw Error('INVALID_SCHEMA');
            validate('MatchResult', row.result);
            rows.set(row.index, row);
            addMatch(groups, row.result);
          } else if (message.type === 'done') {
            if (expected.size) throw Error('INVALID_SCHEMA');
            received = true;
            resolve();
          } else throw Error('INVALID_SCHEMA');
        } catch (error) {
          reject(error);
        }
      });
      worker.once('error', reject);
      worker.once('exit', code => {
        if (code !== 0 || !received) reject(Error(`Worker exited ${code} before completing its batch`));
      });
    })));
    const ordered = [...rows.values()].sort((a, b) => a.index - b.index),
      results = ordered.map(row => row.result);
    report();
    const elapsedMs = performance.now() - start;
    return {
      results,
      ...(captureReplays ? {
        replays: ordered.map(row => row.replay)
      } : {}),
      metrics: {
        kind: 'recorded',
        matchCount: results.length,
        validMatches: results.filter(r => r.valid).length,
        seatWins: results.filter(result => result.valid && result.outcome.winners.includes(result.config.players[
          0])).length,
        invalidMatches: results.filter(r => !r.valid).length,
        workers: count,
        elapsedMs,
        matchesPerSecond: results.length * 1000 / elapsedMs,
        includesWorkerStartup: true,
        botPolicyVersion: jobs[0].botPolicy === 'learned' ? learnedBot().botPolicyVersion :
          scriptedVersionOf(jobs[0].config.gameId),
        botPolicy: jobs[0].botPolicy ?? 'scripted',
        seedSetId: 'explicit-paired-seeds',
        seeds: [...new Set(jobs.map(j => j.config.seed))]
      }
    };
  } finally {
    if (timer) clearInterval(timer);
    await Promise.all(pool.map(worker => worker.terminate()));
  }
}
