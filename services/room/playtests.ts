import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runBatch, pairedJobs, rosterJobs } from '../runner/index.ts';
import { games, scriptedVersionOf } from '../runner/match.ts';
import { learnedBot } from '../runner/learn/load.ts';
import { applyPatch, hash, validateSchema } from '../../packages/contracts/index.ts';
import { array, integer, object, text } from '../../packages/contracts/shapes.ts';
import { writeJson } from './storage.ts';
import { patchChanges } from './versions.ts';
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
const botPolicyEnum = {
  enum: ['scripted', 'learned']
};
export const runRequest = object({
  gameId,
  pairs: integer(1, 1000),
  roster: {
    type: 'boolean'
  },
  heroes: array(text(64), 2, 2),
  botPolicy: botPolicyEnum,
  dataHash: digest
}, ['gameId', 'pairs']);
export const fullRequest = object({
  gameId,
  roster: {
    type: 'boolean'
  },
  pairs: integer(1, 1000),
  holdoutPairs: integer(1, 1000),
  heroes: array(text(64), 2, 2),
  diagnose: {
    type: 'boolean'
  },
  botPolicy: botPolicyEnum,
  dataHash: digest
}, ['gameId']);

// The bot that plays the matches: 'scripted' (scripted-0.2.1, the default) or 'learned' (self-play trained parameters,
// Hero Arena only). The report's botPolicyVersion says which one produced a result; for 'learned' it carries a hash of
// the parameters (learned-cem-1+<8 hex>).
export function resolveBotPolicy(gameId, body) {
  const policy = body.botPolicy ?? 'scripted';
  if (policy === 'scripted') return { botPolicy: 'scripted', botPolicyVersion: scriptedVersionOf(gameId) };
  if (gameId !== 'hero_arena') throw new PipelineError({ code: 'INVALID_SCHEMA',
    message: 'Learned bots exist for Hero Arena only.' });
  const bot = learnedBot();
  if (!bot) throw new PipelineError({ code: 'LEARNED_UNAVAILABLE',
    message: 'No trained bot parameters are available. Use botPolicy "scripted" or run the trainer first.' });
  return { botPolicy: 'learned', botPolicyVersion: bot.botPolicyVersion };
}

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
  botPolicy,
  matchups,
  seeds,
  phase,
  round,
  batchId,
  probe = false, // a card probe: many small runs, so no replays, files, progress events or outside copies
  runId = randomUUID()
}) {
  seeds ??= Array.from({
    length: pairs
  }, (_, index) => index + 1);
  const dataHash = server.storage.addVersion(data);
  const policy = botPolicy === 'learned' ? { botPolicy } : {};
  const jobs = matchups ? matchups.flatMap(matchup => pairedJobs({
    gameId, data, seeds, heroes: matchup.split(' vs '), ...policy
  })) : (roster ? rosterJobs : pairedJobs)({ gameId, data, seeds, ...(heroes ? { heroes } : {}), ...policy });
  batchId ??= runId;
  jobs.forEach((job, index) => {
    job.matchId = `bot-${batchId}-${phase ?? 'run'}-${index + 1}`;
  });
  const batch = await runBatch(jobs, {
    workers: server.workers,
    captureReplays: !probe,
    onProgress: probe ? undefined : progress => {
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
  if (probe) return { ...batch, dataHash };
  batch.replays.forEach(recording => server.storage.recordReplay(recording));
  const fileId = phase ? `${batchId}-${phase}` : batchId;
  writeJson(join(server.storage.directory, 'playtests', `${fileId}.json`), batch.results);
  writeJson(join(server.storage.directory, 'playtests', `${fileId}.metrics.json`), batch.metrics);
  server.sinks.emit('matches', { results: batch.results, dataHash, phase: phase ?? 'run', runId, at: Date.now(),
    botPolicyVersion: batch.metrics.botPolicyVersion ?? botPolicyVersion });
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
  const policy = resolveBotPolicy(body.gameId, body);
  const batch = await matchBatch(server, {
    ...body,
    data
  });
  return {
    botPolicy: policy.botPolicy,
    botPolicyVersion: policy.botPolicyVersion,
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
    pipeline = await import('../../packages/analysis/pipeline/full.ts');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw Error('TRANSPORT_UNAVAILABLE');
    throw error;
  }
  if (typeof pipeline.runFull !== 'function') throw Error('TRANSPORT_UNAVAILABLE');
  const runId = randomUUID(),
    pairs = body.pairs ?? 50,
    // The holdout is as big as the baseline unless asked otherwise: the verdict needs 200 games per target, and a
    // smaller holdout (the old default of 50 pairs against a 100-pair request) can only ever be inconclusive.
    holdoutPairs = body.holdoutPairs ?? pairs;
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
  const isCards = body.gameId === 'hero_cards';
  // Hero Cards has two decks: without a pair or a roster the matchup is the decks against each other.
  const heroes = checkHeroes(body.gameId, data, body) ?? (isCards && !body.roster ? ['nightcrow', 'standard'] :
    undefined);
  const policy = resolveBotPolicy(body.gameId, body);
  const {
    createAdapter
  } = await import('../../packages/analysis/src/adapters.ts');
  const adapter = createAdapter(server.analysisEnv.GEMINI_API_KEY ? 'gemini' : 'fake', server.analysisEnv);
  const intent = await server.design.get(body.gameId);
  const humanSnapshot = structuredClone(server.storage.humans);
  const baseline = await matchBatch(server, {
    gameId: body.gameId,
    data,
    roster: body.roster ?? false,
    heroes,
    botPolicy: policy.botPolicy,
    seeds,
    phase: 'baseline',
    runId
  });
  let holdout;
  const result = await pipeline.runFull({
    baselineResults: baseline.results,
    baseData: data,
    rootData: structuredClone(games[body.gameId].data), // hero stats stay within 40% of the original data
    adapter,
    intent,
    holdoutSeeds,
    hashData: hash,
    botPolicyVersion: policy.botPolicyVersion,
    seedSetId,
    holdoutSeedSetId,
    ...(isCards ? {
      diagnoseSeeds: Array.from({ length: pairs }, (_, index) => 2000001 + index),
      // one run of the unchanged data and one per card lever, each on the same fresh seeds
      runCardProbe: async (variants, seeds) => {
        const root = games[body.gameId].data;
        const run = async patched => (await matchBatch(server, { gameId: body.gameId, data: patched, heroes,
          botPolicy: policy.botPolicy, seeds, probe: true, runId })).results;
        const probes = [{ variant: null, results: await run(data) }];
        for (const variant of variants) {
          const patched = applyPatch(data, { baseDataHash: hash(data), rationale: 'card probe',
            replacements: [{ path: variant.path, value: variant.to }] }, root);
          probes.push({ variant, results: await run(patched) });
        }
        return probes;
      }
    } : {}),
    ...(body.diagnose && !isCards ? {
      diagnoseSeeds: Array.from({ length: pairs }, (_, index) => 2000001 + index),
      runDiagnose: async (matchups, diagnoseSeeds) => (await matchBatch(server, {
        gameId: body.gameId,
        data,
        matchups,
        botPolicy: policy.botPolicy,
        seeds: diagnoseSeeds,
        phase: 'diagnose',
        runId
      })).results
    } : {}),
    humanResults: structuredClone(humanSnapshot),
    elapsedMs: Math.round(baseline.metrics.elapsedMs),
    createdAt: new Date().toISOString(),
    runHoldout: async (patched, seeds) => {
      holdout = await matchBatch(server, {
        gameId: body.gameId,
        data: patched,
        roster: body.roster ?? false,
        heroes,
        botPolicy: policy.botPolicy,
        seeds,
        phase: 'holdout',
        runId
      });
      return holdout.results;
    }
  });
  if (!result.ok) throw new PipelineError(result.error);
  recordFullVersion(server, data, result.value);
  const output = {
    ...result.value,
    runId,
    gameId: body.gameId,
    botPolicy: policy.botPolicy,
    elapsedMs: Math.round(performance.now() - start),
    seatWins: {
      baseline: baseline.metrics.seatWins,
      holdout: holdout?.metrics.seatWins ?? null
    }
  };
  // Kept so the analysis can be re-run on these results under another design intent (POST /v1/playtest/reanalyze).
  const folder = join(server.storage.directory, 'playtests');
  writeJson(join(folder, `${runId}-full.json`), output);
  server.sinks.emit('report', output);
  if (humanSnapshot.length) writeJson(join(folder, `${runId}-humans.json`), humanSnapshot);
  return output;
}

const reanalyzeRequest = object({
  runId: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
  intent: { type: 'object' }
}, ['runId']);

/** Re-runs only the analysis of a stored full run, under the given intent or the saved one. No simulation. */
export async function reanalyzePlaytest(server, body) {
  validateSchema(reanalyzeRequest, body);
  const folder = join(server.storage.directory, 'playtests');
  const read = name => {
    const path = join(folder, `${body.runId}${name}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  };
  const stored = read('-full');
  const baselineResults = read('-baseline');
  if (!stored || !baselineResults) throw new PipelineError({ code: 'INVALID_SCHEMA',
    message: 'Unknown run: only full runs made by this server can be re-analysed.' });
  const intent = body.intent === undefined ? await server.design.get(stored.gameId) :
    await server.design.prepare(stored.gameId, body.intent);
  const { reanalyzeRun } = await import('../../packages/analysis/pipeline/reanalyze.ts');
  const out = await reanalyzeRun({ stored, baselineResults, holdoutResults: read('-holdout'),
    diagnoseResults: read('-diagnose'), humanResults: read('-humans') ?? [],
    baseData: server.storage.get(stored.gameId, stored.baseline.dataHash).data,
    rootData: structuredClone(games[stored.gameId].data), hashData: hash, intent });
  if (!out.ok) throw new PipelineError(out.error);
  return { ...out.value, runId: body.runId, gameId: stored.gameId, botPolicy: stored.botPolicy,
    seatWins: stored.seatWins };
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
