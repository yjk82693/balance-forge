import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runBatch, pairedJobs, rosterJobs } from '../runner/index.js';
import { botPolicyVersion } from '../runner/match.js';
import { hash, validateSchema } from '../../packages/contracts/index.js';
import { integer, object } from '../../packages/contracts/shapes.js';
import { writeJson } from './storage.js';
export class PipelineError extends Error {
  constructor(error) {
    super(error.message);
    this.code = error.code;
  }
}
const gameId = {
  enum: ['hero_arena', 'hero_cards']
};
const digest = {
  type: 'string',
  pattern: '^[0-9a-f]{64}$'
};
export const runRequest = object({
  gameId,
  pairs: integer(1, 1000),
  roster: {
    type: 'boolean'
  },
  dataHash: digest
}, ['gameId', 'pairs']);
export const fullRequest = object({
  gameId: {
    const: 'hero_arena'
  },
  roster: {
    type: 'boolean'
  },
  pairs: integer(1, 1000),
  holdoutPairs: integer(1, 1000),
  dataHash: digest
}, ['gameId']);
export async function matchBatch(server, {
  gameId,
  data,
  pairs,
  roster = false,
  seeds,
  phase,
  runId = randomUUID()
}) {
  seeds ??= Array.from({
    length: pairs
  }, (_, index) => index + 1);
  const dataHash = server.storage.addVersion(data);
  const jobs = (roster ? rosterJobs : pairedJobs)({
    gameId,
    data,
    seeds
  });
  jobs.forEach((job, index) => {
    job.matchId = `bot-${runId}-${phase ?? 'run'}-${index + 1}`;
  });
  const batch = await runBatch(jobs, {
    workers: server.workers,
    captureReplays: true,
    onProgress: progress => {
      for (const session of server.sessions) server.send(session, 'playtest.progress', {
        runId,
        gameId,
        dataHash,
        ...(phase ? {
          phase
        } : {}),
        ...progress
      });
    }
  });
  batch.replays.forEach(recording => server.storage.recordReplay(recording));
  const fileId = phase ? `${runId}-${phase}` : runId;
  writeJson(join(server.storage.directory, 'playtests', `${fileId}.json`), batch.results);
  writeJson(join(server.storage.directory, 'playtests', `${fileId}.metrics.json`), batch.metrics);
  return {
    ...batch,
    resultsPath: `/v1/playtest/results/${fileId}.json`,
    dataHash
  };
}
export async function runPlaytest(server, body) {
  validateSchema(runRequest, body);
  const {
    data
  } = server.storage.get(body.gameId, body.dataHash);
  const batch = await matchBatch(server, {
    ...body,
    data
  });
  return {
    resultsPath: batch.resultsPath,
    elapsedMs: batch.metrics.elapsedMs,
    matchCount: batch.results.length,
    dataHash: batch.dataHash,
    recorded: true,
    seatWins: batch.metrics.seatWins
  };
}
export async function fullPlaytest(server, body) {
  const start = performance.now();
  validateSchema(fullRequest, body);
  let pipeline;
  try {
    pipeline = await import('../../packages/analysis/pipeline/full.js');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw Error('TRANSPORT_UNAVAILABLE');
    throw error;
  }
  if (typeof pipeline.runFull !== 'function') throw Error('TRANSPORT_UNAVAILABLE');
  const runId = randomUUID(),
    pairs = body.pairs ?? 50,
    holdoutPairs = body.holdoutPairs ?? 50;
  const seeds = Array.from({
    length: pairs
  }, (_, index) => index + 1);
  const holdoutSeeds = Array.from({
    length: holdoutPairs
  }, (_, index) => 1000001 + index);
  const seedSetId = `paired-1-${pairs}`,
    holdoutSeedSetId = `holdout-1000001-${1000000 + holdoutPairs}`;
  const {
    data
  } = server.storage.get(body.gameId, body.dataHash);
  const {
    createAdapter
  } = await import('../../packages/analysis/src/adapters.js');
  const adapter = createAdapter(server.analysisEnv.GEMINI_API_KEY ? 'gemini' : 'fake', server.analysisEnv);
  const baseline = await matchBatch(server, {
    gameId: body.gameId,
    data,
    roster: body.roster ?? false,
    seeds,
    phase: 'baseline',
    runId
  });
  let holdout;
  const result = await pipeline.runFull({
    baselineResults: baseline.results,
    baseData: data,
    adapter,
    holdoutSeeds,
    hashData: hash,
    botPolicyVersion,
    seedSetId,
    holdoutSeedSetId,
    humanResults: structuredClone(server.storage.humans),
    elapsedMs: Math.round(baseline.metrics.elapsedMs),
    createdAt: new Date().toISOString(),
    runHoldout: async (patched, seeds) => {
      holdout = await matchBatch(server, {
        gameId: body.gameId,
        data: patched,
        roster: body.roster ?? false,
        seeds,
        phase: 'holdout',
        runId
      });
      return holdout.results;
    }
  });
  if (!result.ok) throw new PipelineError(result.error);
  return {
    ...result.value,
    runId,
    gameId: body.gameId,
    elapsedMs: Math.round(performance.now() - start),
    seatWins: {
      baseline: baseline.metrics.seatWins,
      holdout: holdout?.metrics.seatWins ?? null
    }
  };
}
