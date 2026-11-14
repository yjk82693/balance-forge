import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runBatch, pairedJobs, rosterJobs } from '../runner/index.js';
import { botPolicyVersion } from '../runner/match.js';
import { applyPatch, hash, validateSchema } from '../../packages/contracts/index.js';
import { integer, object } from '../../packages/contracts/shapes.js';
import { writeJson } from './storage.js';

const gameId = { enum: ['hero_arena', 'hero_cards'] };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
export const runRequest = object({ gameId, pairs: integer(1, 1000), roster: { type: 'boolean' }, dataHash: digest },
  ['gameId', 'pairs']);
export const fullRequest = object({ gameId, roster: { type: 'boolean' }, pairs: integer(1, 1000),
  holdoutPairs: integer(1, 1000) }, ['gameId']);

export async function matchBatch(server, { gameId, data, pairs, roster = false, seeds,
  phase, runId = randomUUID() }) {
  seeds ??= Array.from({ length: pairs }, (_, index) => index + 1);
  const dataHash = server.storage.addVersion(data);
  const jobs = (roster ? rosterJobs : pairedJobs)({ gameId, data, seeds });
  jobs.forEach((job, index) => { job.matchId = `bot-${runId}-${phase ?? 'run'}-${index + 1}`; });
  const batch = await runBatch(jobs, { workers: server.workers, captureReplays: true, onProgress: progress => {
    for (const session of server.sessions) server.send(session, 'playtest.progress', {
      runId, gameId, dataHash, ...(phase ? { phase } : {}), ...progress
    });
  } });
  batch.replays.forEach(recording => server.storage.recordReplay(recording));
  const fileId = phase ? `${runId}-${phase}` : runId;
  writeJson(join(server.storage.directory, 'playtests', `${fileId}.json`), batch.results);
  writeJson(join(server.storage.directory, 'playtests', `${fileId}.metrics.json`), batch.metrics);
  return { ...batch, resultsPath: `/v1/playtest/results/${fileId}.json`, dataHash };
}

export async function runPlaytest(server, body) {
  validateSchema(runRequest, body);
  const { data } = server.storage.get(body.gameId, body.dataHash);
  const batch = await matchBatch(server, { ...body, data });
  return { resultsPath: batch.resultsPath, elapsedMs: batch.metrics.elapsedMs, matchCount: batch.results.length,
    dataHash: batch.dataHash, recorded: true, seatWins: batch.metrics.seatWins };
}

export async function fullPlaytest(server, body) {
  validateSchema(fullRequest, body);
  let pipeline;
  try { pipeline = await import('../../packages/analysis/pipeline/full.js'); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw Error('TRANSPORT_UNAVAILABLE');
    throw error;
  }
  const runFull = pipeline.runFullPlaytest ?? pipeline.runFull ?? pipeline.fullPlaytest;
  if (typeof runFull !== 'function') throw Error('TRANSPORT_UNAVAILABLE');
  const start = performance.now(), runId = randomUUID(), pairs = body.pairs ?? 50;
  const holdoutPairs = body.holdoutPairs ?? 50;
  const seeds = Array.from({ length: pairs }, (_, index) => index + 1);
  const holdoutSeeds = Array.from({ length: holdoutPairs }, (_, index) => 1000001 + index);
  const { data } = server.storage.get(body.gameId);
  const { createAdapter } = await import('../../packages/analysis/src/adapters.js');
  const adapter = createAdapter(server.analysisEnv.GEMINI_API_KEY ? 'gemini' : 'fake', server.analysisEnv);
  const runMatches = async options => matchBatch(server, {
    gameId: body.gameId, roster: body.roster ?? false, runId, ...options,
    seeds: options.phase === 'holdout' ? holdoutSeeds : seeds
  });
  const result = await runFull({ ...body, runId, pairs, holdoutPairs, data, baseData: data, seeds, holdoutSeeds,
    adapter, botPolicyVersion, humanResults: structuredClone(server.storage.humans), runMatches,
    hashData: hash, applyPatch: (base, proposal) => {
      const patched = applyPatch(base, proposal); server.storage.addVersion(patched); return patched;
    } });
  return { ...result, runId, gameId: body.gameId, elapsedMs: Math.round(performance.now() - start) };
}
