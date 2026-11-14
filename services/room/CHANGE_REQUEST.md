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

## Round 7 recording consumers

The new required roster run has 100 pairs per matchup: 3,000 games and policy scripted-0.2.0.
Please regenerate packages/analysis/recorded/recorded-roster-report.json from the new runner recordings and
update packages/analysis/test/recorded.test.js to request scripted-0.2.0 (or read it from runner metrics).
packages/analysis/test/replay.test.js:164 still asserts exactly 300 games; the required new run has 3,000.
Please update that expected run size while preserving every replay/hash/outcome/duration assertion.
The matching regenerated report is services/runner/recorded-roster-report.json. These files are outside
engine ownership; their tests remain failing until the analysis owner integrates the recording update.

## Round 7 seeded bot replay boundary

The 0.2.0 recording regeneration is superseded by scripted-0.2.1. New public engine export:
`deriveBotSeed(matchSeed, seatIndex)` in packages/games/action/bot.js returns a nonzero uint32.
Call `chooseActions(view, tick * 2, deriveBotSeed(config.seed, seatIndex))` every tick, with a stable seat index.
The runner and room use this boundary. Analysis-owned pipeline/arena-simulator.js still passes only seatIndex;
please import/pass deriveBotSeed from the bot module and derive the variant from config.seed for every seat.
Do not change any replay/hash assertions; they should validate the regenerated seeded-policy recordings.
The analysis-owned policy-pinned recording test/copy must likewise move to scripted-0.2.1 and 3,000 games.
