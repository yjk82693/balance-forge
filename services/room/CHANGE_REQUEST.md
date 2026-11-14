# Full pipeline integration boundary

Round 6 shared HTTP response is implemented at /v1/playtest/full. The analysis module is currently missing.
The engine bridge will adapt to the real export when it lands; until then its real-module test is pending.

Proposed module export: runFullPlaytest(options), returning the shared response/report/proposal/validation/verdict
fields. Engine passes gameId, runId, roster, pairs, holdoutPairs, data/baseData, seeds, holdoutSeeds, adapter,
botPolicyVersion, humanResults, hashData(data), applyPatch(base,proposal), and runMatches({data,seeds,phase}).
runMatches returns {results,metrics,...}; it runs real workers, archives replay/result files and emits progress.
Engine owns HTTP/WS/storage; analysis owns aggregation, numeric proposal validation, changes labels and verdict.

Baseline seeds are 1..pairs; holdout is 1000001..1000000+holdoutPairs. Candidate data is retained by hash without
silently promoting it over the baseline. Production selects Gemini with a key, fake without; tests pass env={}.
No changes to shared spec or analysis-owned files were made by this branch.

## Resolved analysis API

Read the new analysis-worktree full.js: export runFull(input) returns {ok,value} or an error result.
Updated bridge to supply baselineResults, baseData, adapter, holdoutSeeds, hashData, botPolicyVersion, seedSetId,
holdoutSeedSetId, humanResults, measured elapsedMs/createdAt and runHoldout(patchedData,seeds) -> MatchResult[].
Both baseline and holdout still use real matchBatch workers and phase-labelled progress. The bridge is ready
for that exact module to land in this worktree; the provisional callback proposal above is superseded.

## Solo result marker

Round 6 explicitly asks recorded solo results to identify their bot seat. Added optional bounded/unique
MatchResult.botSeats: string[] in the owned schema/types (normal bot/human result shapes remain unchanged).
Room persistence verifies IDs reference config.players. Integrator should record this optional addition in the
shared contract; spec and fixtures remain untouched by this branch.
