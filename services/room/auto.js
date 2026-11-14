import { randomUUID } from 'node:crypto';
import { hash, applyPatch, validateSchema, validate } from '../../packages/contracts/index.js';
import { object, integer } from '../../packages/contracts/shapes.js';
import { games, botPolicyVersion } from '../runner/match.js';
import { matchBatch, PipelineError } from './playtests.js';
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const requestSchema = object({
  gameId: { enum: ['hero_arena', 'hero_cards'] }, fromHash: digest, rounds: integer(1, 5),
  requireApproval: { type: 'boolean' }
}, ['gameId']);
const stops = new Set(['fair', 'not_accepted', 'regression', 'rounds', 'awaiting_approval', 'error']);

export function autoSeeds(round, phase) {
  if (!Number.isInteger(round) || round < 1 || round > 6 || !['scan', 'holdout'].includes(phase)) {
    throw Error('INVALID_SCHEMA');
  }
  const offset = (round - 1) * 200 + (phase === 'holdout' ? 100 : 0);
  return Array.from({ length: 100 }, (_, index) => offset + index + 1);
}
function matchupsFor(gameId, data) {
  const roster = (gameId === 'hero_arena' ? data.characters : data.gameRules.decks).map(hero => hero.id).sort();
  return roster.flatMap((hero, index) => roster.slice(index).map(other => `${hero} vs ${other}`));
}
export async function autoPlaytest(server, body) {
  validateSchema(requestSchema, body);
  let runAuto = server.runAuto;
  if (!runAuto) {
    try {
      ({ runAuto } = await import('../../packages/analysis/pipeline/auto.js'));
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') throw Error('TRANSPORT_UNAVAILABLE');
      throw error;
    }
  }
  if (typeof runAuto !== 'function') throw Error('TRANSPORT_UNAVAILABLE');
  const { data, dataHash: fromHash } = server.storage.get(body.gameId, body.fromHash);
  if (!server.storage.versionStore.get(body.gameId, fromHash)) throw Error('HASH_MISMATCH');
  const { createAdapter } = await import('../../packages/analysis/src/adapters.js');
  const adapter = createAdapter(server.analysisEnv.GEMINI_API_KEY ? 'gemini' : 'fake', server.analysisEnv);
  const runId = randomUUID(), allMatchups = matchupsFor(body.gameId, data);
  let progress = { round: 1, phase: 'scan' }, batchIndex = 0;
  const onProgress = update => {
    if (!Number.isInteger(update.round) || update.round < 1 || update.round > (body.rounds ?? 3) + 1 ||
        typeof update.phase !== 'string' || !update.phase.length || update.phase.length > 64) {
      throw Error('INVALID_SCHEMA');
    }
    progress = { round: update.round, phase: update.phase };
    for (const session of server.sessions) server.send(session, 'playtest.progress', {
      ...update, ...progress, runId, gameId: body.gameId
    });
  };
  const onRecord = record => {
    if (record.gameId !== body.gameId) throw Error('INVALID_SCHEMA');
    server.storage.get(record.gameId, record.dataHash);
    return server.storage.recordVersion(record);
  };
  const result = await runAuto({
    gameId: body.gameId, fromHash, data: structuredClone(data), rounds: body.rounds ?? 3,
    requireApproval: body.requireApproval ?? true, adapter, hashData: hash, allMatchups,
    applyPatch: (base, proposal) => {
      if (base.gameId !== body.gameId) throw Error('INVALID_SCHEMA');
      const data = applyPatch(base, proposal, games[body.gameId].data);
      return { data, dataHash: server.storage.addVersion(data) };
    },
    runBatch: async (dataHash, matchups, seeds) => {
      if (!Array.isArray(matchups) || !matchups.length || new Set(matchups).size !== matchups.length ||
          matchups.some(matchup => !allMatchups.includes(matchup))) throw Error('INVALID_SCHEMA');
      const { data } = server.storage.get(body.gameId, dataHash);
      const batch = await matchBatch(server, {
        gameId: body.gameId, data, seeds, matchups, ...progress, runId, batchId: `${runId}-${++batchIndex}`
      });
      return batch.results;
    },
    seedsFor: autoSeeds, botPolicyVersion, onProgress, onRecord
  });
  if (!result || !Array.isArray(result.records) || !stops.has(result.stoppedBecause)) throw Error('INVALID_SCHEMA');
  const records = result.records.map(record => onRecord(record));
  if (result.finalCheck !== null) validate('Report', result.finalCheck);
  return { ...result, records, runId, gameId: body.gameId };
}
