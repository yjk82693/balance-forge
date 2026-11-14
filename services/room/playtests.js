import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runBatch, pairedJobs, rosterJobs } from '../runner/index.js';
import { botPolicyVersion } from '../runner/match.js';
import { hash, validateSchema } from '../../packages/contracts/index.js';
import { array, integer, object, text } from '../../packages/contracts/shapes.js';
import { writeJson } from './storage.js';
import { patchChanges } from './versions.js';
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
  heroes: array(text(64), 2, 2),
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
  heroes: array(text(64), 2, 2),
  dataHash: digest
}, ['gameId']);

// heroes: [a, b] picks one matchup. Both must be playable in this data version and different (a mirror only measures
// the first-seat advantage). Errors keep their own codes so the screen can say what is wrong.
export function checkHeroes(gameId, data, body) {
  const { heroes, roster } = body;
  if (heroes === undefined) return undefined;
  if (roster) throw new PipelineError({ code: 'INVALID_SCHEMA', message: 'Use either heroes or roster, not both.' });
  const known = (gameId === 'hero_arena' ? data.characters : data.gameRules.decks).map(item => item.id);
  for (const hero of heroes) if (!known.includes(hero)) throw new PipelineError({
    code: 'HERO_NOT_PLAYABLE', message: `Hero ${hero} is not playable in this version of the game.`
  });
  if (heroes[0] === heroes[1]) throw new PipelineError({
    code: 'MIRROR_MATCHUP', message: 'Choose two different heroes: a mirror matchup does not test hero balance.'
  });
  return [...heroes];
}
export async function matchBatch(server, {
  gameId,
  data,
  pairs,
  roster = false,
  heroes,
  matchups,
  seeds,
  phase,
  round,
  batchId,
  runId = randomUUID()
}) {
  seeds ??= Array.from({
    length: pairs
  }, (_, index) => index + 1);
  const dataHash = server.storage.addVersion(data);
  const jobs = matchups ? matchups.flatMap(matchup => pairedJobs({
    gameId, data, seeds, heroes: matchup.split(' vs ')
  })) : (roster ? rosterJobs : pairedJobs)({ gameId, data, seeds, ...(heroes ? { heroes } : {}) });
  batchId ??= runId;
  jobs.forEach((job, index) => {
    job.matchId = `bot-${batchId}-${phase ?? 'run'}-${index + 1}`;
  });
  const batch = await runBatch(jobs, {
    workers: server.workers,
    captureReplays: true,
    onProgress: progress => {
      for (const session of server.sessions) server.send(session, 'playtest.progress', {
        runId,
        gameId,
        dataHash,
        ...(round === undefined ? {} : { round }),
        ...(phase ? {
          phase
        } : {}),
        ...progress
      });
    }
  });
  batch.replays.forEach(recording => server.storage.recordReplay(recording));
  const fileId = phase ? `${batchId}-${phase}` : batchId;
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
  checkHeroes(body.gameId, data, body);
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
  const heroes = checkHeroes(body.gameId, data, body);
  const {
    createAdapter
  } = await import('../../packages/analysis/src/adapters.js');
  const adapter = createAdapter(server.analysisEnv.GEMINI_API_KEY ? 'gemini' : 'fake', server.analysisEnv);
  const baseline = await matchBatch(server, {
    gameId: body.gameId,
    data,
    roster: body.roster ?? false,
    heroes,
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
        heroes,
        seeds,
        phase: 'holdout',
        runId
      });
      return holdout.results;
    }
  });
  if (!result.ok) throw new PipelineError(result.error);
  recordFullVersion(server, data, result.value);
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

function recordFullVersion(server, baseData, result) {
  if (!result.patchedDataHash || !result.validation.ok) return;
  const { data } = server.storage.get(baseData.gameId, result.patchedDataHash);
  const row = result.baseline.rows.filter(row => !row.dimension.startsWith('human: '))
    .filter(row => { const [a, b] = row.dimension.split(' vs '); return a !== b; })
    .sort((a, b) => Math.abs(b.winRate - 0.5) - Math.abs(a.winRate - 0.5))[0];
  const after = result.patched?.rows.find(item => item.dimension === row?.dimension);
  const summary = row => ({ rate: row.winRate, ci95: row.ci95, games: row.games });
  server.storage.recordVersion({
    dataHash: result.patchedDataHash, parentHash: hash(baseData), gameId: baseData.gameId,
    createdAt: new Date().toISOString(), origin: result.proposal.origin,
    changes: result.proposal.changes ?? patchChanges(baseData, data, result.proposal),
    rationale: result.proposal.rationale, target: row && after ? {
      matchup: row.dimension, before: summary(row), after: summary(after)
    } : null, verdict: result.verdict, approved: false
  });
}
