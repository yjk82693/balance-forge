import { patchChanges } from './versions.ts';

// Injected analysis boundary for route/E2E tests until auto.js lands; never a production fallback.
export async function twoRoundAuto(input) {
  let data = input.data, parentHash = input.fromHash;
  const records = [];
  for (let round = 1; round <= input.rounds; round++) {
    const scanSeeds = input.seedsFor(round, 'scan').slice(0, 1);
    const matchups = [input.allMatchups.find(matchup => matchup === 'bari vs real_armor')];
    input.onProgress({ round, phase: 'scan', matchesDone: 0, totalMatches: 2 });
    const scan = await input.runBatch(parentHash, matchups, scanSeeds);
    input.onProgress({ round, phase: 'scan', matchesDone: scan.length, totalMatches: scan.length });
    const proposal = {
      baseDataHash: parentHash, replacements: [{ path: '/moves/1/power', value: round === 1 ? 72 : 64 }],
      rationale: 'Injected analysis boundary test.'
    };
    const patched = input.applyPatch(data, proposal);
    input.onProgress({ round, phase: 'holdout', matchesDone: 0, totalMatches: 2 });
    const holdout = await input.runBatch(patched.dataHash, matchups, input.seedsFor(round, 'holdout').slice(0, 1));
    input.onProgress({ round, phase: 'holdout', matchesDone: holdout.length, totalMatches: holdout.length });
    const record = {
      dataHash: patched.dataHash, parentHash, gameId: input.gameId, createdAt: new Date().toISOString(),
      origin: 'fake', changes: patchChanges(data, patched.data, proposal), rationale: proposal.rationale,
      target: null, verdict: { verdict: 'accepted', reasons: ['Injected test verdict.'] }, approved: false
    };
    input.onRecord(record);
    records.push(record);
    if (input.requireApproval) return { records, stoppedBecause: 'awaiting_approval', finalCheck: null };
    data = patched.data;
    parentHash = patched.dataHash;
  }
  return { records, stoppedBecause: 'rounds', finalCheck: null };
}
