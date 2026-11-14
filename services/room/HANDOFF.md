# Round 8 versions handoff

Stopped at Tony's request after a clean service test run. No commits were attempted; an outside committer is
saving progress. Write only in packages/contracts, packages/sim, packages/games, services and the explicitly
assigned tests/e2e scenario. Do not edit analysis, web, spec, fixtures or root files. No dependencies or outside
network; preserve every existing assertion and socket gate.

## Done

- versions.js: VersionStore implements atomic per-game JSON ledgers under configured-storage/data/versions.
  Records follow the shared shape, validate metadata, preserve roots/branches and deduplicate by content hash.
  approve() persists approval without selecting data. get/list return copies parsed from disk.
- files.js: extracted the existing atomic writer; storage.js still re-exports writeJson for existing callers.
- storage.js: initializes base root records; patch() records manual provenance and then selects the candidate,
  preserving previous behavior. recordVersion() checks hashes and old/new numeric values against retained data.
  select() persists the server-wide current pin without touching rooms. restoreVersionRecords() imports older
  retained data as explicitly labelled manual branches from base; the note says original lineage is unknown.
- playtests.js: fullPlaytest() records validated candidates, parent hashes, proposal changes, target summaries
  and verdicts without selecting the candidate. matchBatch() can run selected canonical matchup strings,
  attach round/phase progress and use a separate batchId for archive identities while preserving the runId.
- server.js routes: GET /v1/versions/:gameId returns an array. GET /v1/versions/:gameId/:hash returns the flattened
  record plus diff (the numeric changes). POST .../:hash/approve takes {} and returns the approved record.
  POST /v1/data/:gameId/select takes {dataHash} and returns {gameId,dataHash}. Rooms retain their own pins.
- auto.js: autoPlaytest() accepts {gameId,fromHash?,rounds?,requireApproval?}; defaults are 3 and true, max 5.
  Uses injected server.runAuto, otherwise dynamically imports packages/analysis/pipeline/auto.js. Uses exactly
  the FINAL input field names Tony supplied: gameId, fromHash, data, rounds, requireApproval, adapter, hashData,
  applyPatch, runBatch, seedsFor, allMatchups, botPolicyVersion, onProgress, onRecord. No interim fields remain.
  applyPatch uses engine validation and retains candidate data. runBatch uses real worker_threads and only
  requested matchups. onRecord persists checked records. Results include canonical stored records/runId/gameId.
  autoSeeds provides 100 disjoint seeds per round/scan-or-holdout, including a sixth slot for a final check.
- server.js: createRoomServer({runAuto}) supports injection. /v1/playtest/auto shares the run/full concurrency
  lock and task cleanup. No production fake auto implementation was added.
- versions.test.js covers all version routes, branches/restart, full provenance, bad hashes/cross-game pins,
  retained-data import and false diff rejection. auto.test.js covers two rounds, phase progress, seed separation,
  approval defaults/resume and concurrency/error cleanup with the explicitly injected analysis boundary.
- auto-test-helpers.js: twoRoundAuto is ONLY a test stub. It runs real scan/holdout workers and makes two numeric
  test candidates; its accepted verdict is synthetic. Do not use it as a production fallback or balance evidence.
- tests/e2e/full-flow.test.js: added a separate, existing-convention socket-gated scenario with two injected auto
  rounds, two child records, selection of the first and a real room playing it. Original full-flow assertions are
  intact. setup(t,{runAuto}) injects the dependency. README labels this scenario as boundary/transport coverage.

## Half-done and exact next steps

1. Integrate main 1736a3a externally as Tony planned. At this stopping point the local analysis/pipeline directory
   still has no auto.js, so real runAuto was NOT exercised. Do not claim the injected tests verify its algorithm.
2. Read the merged packages/analysis/pipeline/auto.js before changing auto.js:autoPlaytest. Verify allMatchups is
   the expected type: engine currently supplies sorted canonical strings such as "bari vs real_armor", including
   mirrors. Verify onProgress arrives BEFORE runBatch to label the correct round/phase. Final-check rounds/phases
   must agree with the analysis module; engine currently permits a sixth seed slot and bounded phase strings.
3. Run the real auto route with a temp storageDir and analysisEnv:{}; add a real-module integration regression
   alongside the injected tests. Verify approval stop/resume, accepted-parent chaining, narrowed scans, fresh
   holdouts and finalCheck. Do not require synthetic acceptance or change verdict thresholds to force two rounds.
   If the real fake adapter stops early/no-ops, keep the labelled two-round boundary test and test that real stop.
4. auto.js:autoPlaytest currently validates returned records/stoppedBecause/finalCheck and passes optional error
   through in the normal result shape. Check the real module's error/finalCheck behavior. No pending/skip gate
   was added for the absent module; default import failure is the existing TRANSPORT_UNAVAILABLE HTTP error.
5. Update services/room/README.md with every new route, request and real response example. Update
   generate-examples.js:collectExamples and documentation.test.js to capture/assert version/approve/select/auto
   coverage. These documentation/example updates have NOT been done yet. Existing examples.json is unchanged;
   do not regenerate benchmark/recorded roster files for this task.
6. Run all node:test tests after integration. Earlier Round 7 had analysis-owned recording/policy/replay failures;
   inspect current main results rather than weakening those assertions. Relevant follow-ups are in CHANGE_REQUEST.
7. Run opt-in socket/E2E tests only where localhost listeners are permitted, keeping RUN_SOCKET_TESTS=1 gates.
   They were not run here. If the new E2E scenario is extended to real auto, retain its existing assertions and
   clearly distinguish route-boundary tests from real analysis integration.
8. Update REPORT under "Round 8 versions" with final verification and remaining limitations. No more edits were
   started after the clean point except this handoff/report, per Tony's stop request.

## Tests at the clean stopping point

node --test services/room/*.test.js services/runner/*.test.js tests/e2e/*.test.js

Result: 69 tests, 62 passed, 0 failed, 7 socket-gated skips (5 room tests plus 2 E2E scenarios), no TODO;
11,313.999083 ms. The skips use the established localhost convention; no assertions were weakened or deleted.
The focused new version/auto group has 11 passed, 0 failed. Readability guards and git diff --check pass.
The broad service run includes full/persistence/startup/scheduler/progress/replay/solo/worker regressions.

Focused commands:

    node --test services/room/versions.test.js services/room/auto.test.js
    node --test services/room/documentation.test.js services/room/readability.test.js
    node --test
    RUN_SOCKET_TESTS=1 node --test tests/e2e/full-flow.test.js

All route tests use temporary storage; real auto tests must do likewise and force analysisEnv:{} to avoid LLM
network calls. The E2E setup uses 127.0.0.1:0 and temp storage/static assets only. Do not write runtime results
into the repository while testing.
