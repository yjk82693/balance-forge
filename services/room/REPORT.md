# Server implementation report

Commits are performed outside this sandbox. This task writes only owned engine/service files and runs node:test.

## Match assignments

Adopted the approved optional MatchConfig.options.assignments and optional report metadata from the addendum.
GameData no longer contains seats. Runner pairs reverse assignments, retain the same seed, and share one dataHash.
Arena action catalogs now expose separate move axes and attack aim parameters, with maxHp on entities.
Old v0.1 fixture shapes remain valid. Focused contracts/game/runner tests: 26 passed.

## Separate move action

Move accepts bounded moveX/moveY every tick unless stunned or eliminated, including during recovery and cooldown.
Movement consumes no cooldown and is excluded from attack uses/opportunities. Bots send movement plus a legal attack.
Frames and Authority allow at most one move and one attack per seat, with distinct monotonic sequences.
Tests cover movement through startup/recovery/cooldown, stun rejection, duplicate categories, receipts, and replay.
Full determinism matrix will run after the requested formatting pass, before server implementation.

## Readability and determinism

Formatted all packages/games and packages/sim files using already installed tooling; no dependencies added.
Verified zero lines over 120 characters. All 28 engine/runner tests passed after the movement and assignment changes.
The 100 seeds × 1,000 ticks × two independent runs matrix passed every input and state hash comparison in 50.19 s.

## Room server and join flow

Implemented services/room/server.js, protocol.js, storage.js, and cli.js using installed ws and node:http.
Four-character room codes; connection-bound seat ownership; host-only start/reset/select; room status with hero/you;
match.started, input.ack, state.view with viewHash, actions.available, match.ended; plain-disconnect handling.
Arena advances at 60 logical ticks/s using a monotonic accumulator outside simulation state. Cards advance only on
accepted actions or logged authoritative timeout frames. Input envelopes are bounded to 64 KiB and depth 32;
seat, epoch, tick, sequence, action domain, per-tick category count and 120 submissions/s limits are checked.
Accepted duplicate sequences return prior receipts. Rejected inputs do not enter the accepted frame history.
Human MatchResult arrays are written atomically to services/room/human-results.json before match.ended is sent.
Reset/shutdown of an unfinished match records an invalid result rather than a draw.

Implementation is present, but socket integration is NOT verified: sandbox denial described below.

## Data and playtest APIs

Implemented on the same HTTP server:

- POST /v1/playtest/run {gameId, pairs}: worker_threads batch, fixed paired seeds, resultsPath and elapsedMs.
  GET the returned /v1/playtest/results/<id>.json path to retrieve the MatchResult array.
- GET /v1/data/:gameId: current {data, dataHash}; optional ?dataHash=<retained-hash> retrieves a base version.
- POST /v1/data/:gameId/apply-patch {proposal}: validated allowlisted numeric replacements; returns new dataHash
  and baseDataHash. Base content is retained, current selection persisted, active matches keep their pinned data.
- GET /v1/games and POST /v1/rooms {gameId} are also available. HTTP room creation returns a hostToken for
  attaching the host WebSocket; the token is not included in results or public room status.
- Static files are served from apps/web/dist, including SPA fallback, with realpath confinement.

These paths are implemented but their HTTP integration tests could not execute because binding was denied.

## Start command

From the repository root:

```
node services/room/cli.js
```

Default bind: 0.0.0.0:3000; HOST and PORT override it. Laptop and phones use the same server's LAN URL.
A prebuilt apps/web/dist is required for the static UI. It was absent at inspection; no files in apps/web were
modified or generated because that directory is outside this task's ownership. The existing web source still
uses its mock transport and needs the web owner to connect it to this protocol.

WebSocket host shortcut: /ws?role=display&gameId=hero_arena (or hero_cards) creates a room and sends room.status.
Controllers connect to /ws and receive their sessionId in an initial room.status; they send room.join with
{joinCode, name, hero}. Every command uses the spec envelope, the server-issued sessionId, roomId and epoch.
The host can also occupy a seat. Additional displays can attach read-only with /ws?roomId=<id>.
For HTTP-created rooms, attach the host with /ws?roomId=<id>&hostToken=<token>.

match.start accepts optional gameId, seed, maxTicks (1..1800). Inputs target the next authoritative tick only.
Arena sends state.view/actions.available every tick; cards send them after accepted actions/timeouts.
Movement and attacks use separate ActionInput envelopes with distinct increasing seq values in the same tick.
Cards currently support the standard deck assignment. Match reset clears simulation/receipts, increments epoch,
and returns connected seats to the lobby; disconnected seats are removed.

## Socket verification blocker

Ran:

```
node --test services/room/room.test.js
```

Five tests were attempted; all five failed before any WebSocket/HTTP exchange at server.listen on an ephemeral
loopback port:

```
listen EPERM: operation not permitted 127.0.0.1
```

This sandbox denies TCP listener creation, independently of the already-known read-only Git restriction.
No escalation or permission bypass was attempted. Per the repository's stop-when-blocked rule, implementation
work stopped here. Do not treat the server implementation or HTTP APIs as integration-verified.

The test suite is ready to run in an environment permitting localhost listeners. It covers two actual ws clients,
300 scripted fixed ticks (with movement plus aimed attacks), match.ended and exact recorded MatchResult,
seat/tick/seq/domain rejection immutability, duplicate receipts, card timeout/privacy, static confinement,
retained base patches, worker playtests for both games, join limits, disconnects, reset, and stale epochs.

Previously completed verification before this blocker: 28 engine/runner tests passed, including the full
100-seed × 1,000-tick × two-run determinism matrix after movement/assignment/formatting changes.
No commits were attempted, no dependencies added, and no external network calls made.

## Match replay

Completed H. GET /v1/replay/:matchId serves archived seed/config and the actual accepted InputFrame stream.
Human and HTTP bot matches persist replays separately from unchanged MatchResult exports; match IDs are unique.
No in-progress private replay is exposed. replayOnData reuses the seed/assignments/inputs with a new immutable data
pin; illegal counterfactual inputs fail explicitly instead of being replaced. Two new replay tests and three
runner tests passed without opening sockets, including original final-hash reproduction and patched-data repeats.

## Fifth hero and deck

Completed N. Nightcrow is arena content only: crow_dive, crow_swarm, wing_shield use existing archetypes/tiers/effects
and ordinary damage/shield values; no character-specific branches or new guard bypass. Only spirit_arrow retains
its existing intended arena exception. The nightcrow card deck has mechanical_crows summons and a generic peek
card; revealed next-card identity is private to its owner and expires at the next turn boundary. No boosted matchup
rule.
The expanded schemas remain closed and bounded; deck references and assignments are validated.
All 28 selected game/sim/runner/replay tests passed, including the 100-seed matrix with all five heroes (48.33 s).

Measured `node services/runner/benchmark.js`: 15 unordered matchups including mirrors × 10 seeds × 2 seat orders
= 300 matches, 300 valid, 0 invalid, 2 workers. Recorded at 2026-11-14T03:39:53.643Z: 4,805.539334 ms,
62.427956 matches/s including worker startup. Actual outputs: services/runner/recorded-roster-match-results.json
and recorded-roster-metrics.json. Previous smaller-roster samples are historical, not current balance evidence.

## Live playtest progress

Completed G. Workers report individual completions; runBatch emits initial, ~100 ms, and final progress snapshots.
Room WebSockets receive playtest.progress with runId/gameId/dataHash, matchesDone, totalMatches, elapsedMs and
per-matchup wins/games/draws/invalid counts. Final ordered MatchResult arrays retain their existing shape and
values; progress observers cannot change simulation outcomes. Eight runner/replay/room tests passed, including
cadence, monotonicity, all 15 matchup totals, equal streamed/plain results, and persisted bot replays.

## Combat event views

Completed I. state.view now carries that step's ordered events: combat.hit, combat.guard (activate/block),
combat.ko, projectile.spawn and projectile.expire (hit/lifetime/bounds). IDs are tick/ordinal based; no cosmetic
RNG, clock or display fields enter simulation state. Viewer audience filtering protects card.peek events, and
resending an unchanged view does not repeat transient events. Five event/replay tests passed, including all
expiry reasons, one KO per elimination, deterministic event streams, private filtering and real step forwarding.

## Phone reconnect and clear errors

Completed K. A private seatToken in the owner's room.status reserves a disconnected active-match seat for exactly
10 seconds. reconnect {joinCode, seatToken, lastAck?} (or room.join with seatToken) resumes the same seat/hero,
match, content pin, sequence cursor and receipts. Tokens rotate on resume; expired/active/foreign tokens cannot
claim a seat. Tokens never appear in peer seat lists, MatchResults or replays. Simulation continues neutrally
while disconnected; no new controller may replace a player mid-match.
Malformed JSON, shape/domain violations, bad URLs/upgrades, binary messages, stale epochs and failed sends are
contained and return stable error codes plus readable messages. Transient result-write failures retain a retry
queue and do not emit a false saved result or escape the timer callback. Five new reconnect/hardening tests passed,
including the exact ten-second boundary, duplicate receipts, private tokens, send/write failures, and a 300-tick
match through production handlers. The combined room/runner run passed 14 tests with zero failures.

Per the current no-network instruction, the five real-listener integration tests now require explicit external
opt-in: `RUN_SOCKET_TESTS=1 node --test services/room/room.test.js`. They are skipped in the default suite, not
claimed as verified. New socket-free tests invoke the actual message handlers and HTTP request listener using
in-memory streams, while real worker_threads and persistence still execute.

## Final verification

Round 3 completed in order H → N → G → I → K. No dependency additions, network calls, listener attempts, pushes
or commits in this round. Only packages/contracts, packages/sim, packages/games and services files were written.
`node --test`: 68 passed, 0 failed, 5 explicitly skipped listener tests; total duration 49,019.812 ms. The final
five-hero determinism matrix compared every tick of two independent 1,000-tick runs across 100 seeds and passed
in 48,752.986875 ms. A final documentation-only readability check also passed; all game/sim lines stay <=120.

After all code changes, re-ran `node services/runner/benchmark.js`: 300/300 valid matches across 15 matchups,
0 invalid, 2 workers, recorded at 2026-11-14T03:54:09.218Z. Elapsed 6,273.891542 ms; throughput 47.817212 matches/s
including worker startup. This final measurement supersedes the earlier step-N throughput for the final code.
Actual result/metadata artifacts remain recorded-roster-match-results.json and recorded-roster-metrics.json under
services/runner. Metadata includes game/simulation/content identity; all 300 results share exactly one dataHash.

Start remains `node services/room/cli.js`. New usage/protocol details are in services/room/README.md.
Real TCP/WebSocket transport remains unverified here: five opt-in tests require an environment permitting local
listeners. Production handlers, HTTP routing/static confinement, workers, persistence/retries, replay, progress,
private events and reconnect behavior were exercised without network. The UI transport/build remains the web
owner's responsibility; this task did not change apps/web.

## Polish 23:17

- Fixed inherited schema/reference lookups, sparse-array validation, empty/unknown runner inputs, snapshot config
  mismatches, replay/result identity checks, failed atomic-write cleanup, and stale hashes after game switches.
- Failed data-index writes now leave both the in-memory and persisted current content pin unchanged.
- Split contract validation/canonicalization and arena combat into named helpers; removed unused imports and a
  redundant lookup. Every owned file is within 120 columns. Only intentional CLI output remains.
- Initial suite: 68 passed, 0 failed. Final suite: 77 passed, 0 failed, 5 unchanged opt-in network skips; 51.26 s.
  No test was weakened, removed or newly skipped. Contract declarations type-check; 12 final focused tests pass.
- Final recorded measurement: 300 valid matches, 15 matchups, 2 workers, 4,318.634625 ms, 69.466400 matches/s
  including startup, at 2026-11-14T04:17:24.632Z. All 300 complete results/hashes match the pre-refactor run.
  Artifacts: services/runner/recorded-roster-match-results.json and recorded-roster-metrics.json.
- Still unverified: real TCP/WebSocket transport under the no-network rule. Existing socket-free production-handler
  tests cover disconnect/reconnect and persistence. No web build/render FPS: the web app is outside ownership.
- No dependencies, network, push or commits; files are left for the external commit process.

## Round 4

Scope: stable bot compatibility, graceful startup/readiness, and complete protocol examples. No commits;
progress is committed externally. No network or dependencies added; only owned engine/service files changed.

## Stable bot exports

Read the analysis report and replay adapter. No separate engine CHANGE_REQUEST file was present there;
its replay adapter already prefers chooseActions with an optional single-input fallback. Assignment/human-result
assumptions in the report are resolved here; per-card action statistics remain a separate integration request.
Added the thin deprecated chooseAction(view, seq, variant) alias, documented as "for old callers": it selects the
attack from chooseActions without changing its seq, or returns null. chooseActions behavior/policy is unchanged.
Two export/behavior tests passed, including movement-only and spectator cases.

## Startup and readiness

CLI startup now catches bind/configuration failures, closes partial server resources, writes a readable message
without a stack trace, and sets exitCode=1. EADDRINUSE explicitly names the busy port and suggests choosing PORT.
Added tests for that failure using the real RoomServer.listen error path, invalid-port failure through the actual
CLI subprocess, listener permissions, and failed shutdown. Four startup tests passed without opening sockets.
GET /v1/games is registered before listen and needed 0.50 ms after an in-memory listening event in this run;
the test enforces <1 second. Existing opt-in TCP tests now also enforce the one-second readiness check after
binding. Real OS port contention/TCP timing remains unverified under the no-network sandbox; no tests were skipped
or weakened to obtain the new results. tools/demo.mjs was read from the integration worktree, not modified.

## Protocol examples

Replaced the abbreviated README with every implemented HTTP route (including retained data, static GET/HEAD and
/ws upgrade) and all eight incoming/nine outgoing application message types. Each has an example and response
shape; large bodies are explicitly labelled excerpts and linked to complete captures in examples.json.
The captures use real handlers, persistence and workers, with private tokens redacted; no TCP listeners.
Added a reproducible generator and three tests checking schema-valid examples, complete message/route coverage,
and fresh handler responses against the documented catalog, data and observation. All three pass.
README examples explain host/phone ownership, tokens, input/transport sequences, reconnect, progress and errors.

## Round 4 verification

Full `node --test`: 86 passed, 0 failed, 5 unchanged opt-in TCP skips; 48,257.040708 ms, including the complete
100-seed determinism matrix. New checks cover both bot exports, attack-only compatibility, graceful port/config
failure, readiness, shutdown, complete protocol examples and fresh-handler agreement. Final in-memory catalog
readiness: 0.54 ms after listening; real OS port contention and TCP latency are not claimed as verified.
No new skips or weakened assertions. Every owned file remains within 120 columns. No commits, dependencies,
network calls, pushes, web/spec/fixture/root changes. Files remain available for the external commit process.

## Round 5

Added the explicitly requested tests/e2e files; no root package.json, analysis, spec, fixture or web files changed.
No dependencies, push or commits. The scenario is opt-in under RUN_SOCKET_TESTS=1 and restricts every HTTP/WS
connection to the server's 127.0.0.1 origin, with redirects rejected.

## Full flow scenario

Added node:test coverage for a real display and two real ws phones, chooseActions-driven human play, exactly one
new valid recorded human result with both assignments, a 20-pair worker run and monotonic/reconciled progress.
It invokes the real analysis pipeline/fake adapter, applies the proposal through HTTP, selects disjoint holdout
seeds 21..40 from the patched prefix run, checks the verdict and human-inclusive report, fetches baseline replay
frames, and replays them on both pins through the analysis replay helper. A second match drops and resumes Bari
with its private token inside ten seconds, checking the same config/seat/hero and newer accepted receipts.
All runtime data, static fixtures and analysis artifacts use mkdtemp; cleanup closes sockets/server/workers and
removes temporary files on success or failure. No lower verdict thresholds or synthetic analysis are substituted.

## E2E instructions

Added tests/e2e/README.md with the direct test:e2e command, default gate, dependencies, isolation, cleanup, timeouts
and honest holdout semantics. It explains npm-script wiring for the integrator without editing root files.
The test fails clearly if the required merged packages/analysis modules are unavailable; it never imports another
worktree as a hidden fallback. All new test/documentation lines are within 120 columns.

## Round 5 verification

`node --check tests/e2e/full-flow.test.js`: passed.
`node --test tests/e2e/full-flow.test.js`: one explicitly skipped scenario, as requested when the flag is absent.
`RUN_SOCKET_TESTS=1 node --test tests/e2e/full-flow.test.js`: one failure, left explicit and not weakened:
packages/analysis/pipeline/pipeline.js is missing in this engine worktree. The pipeline/replay/human APIs were read
from the analysis worktree to implement the integration correctly, but were not copied or modified.
This dependency blocks live execution before server setup or any TCP bind. The full flow is NOT claimed as run
or passing. After analysis is merged, it also requires an environment permitting loopback listeners (the earlier
sandbox rejected them). Temporary data was not created by the preflight failure; no repository runtime output
was changed. No commits were attempted under the sandbox rule.

## Round 6 full route

Added /v1/playtest/full request validation/defaults and lazy wiring to the analysis full pipeline, with real
phase-labelled worker batches, retained candidate versions, offline/Gemini adapter selection, isolated test env,
and disjoint baseline/holdout seed arrays. Added roster and retained dataHash selection to /v1/playtest/run.
The analysis full.js module is not present yet: the route returns an explicit 503 and its integration test is
marked TODO, as requested. No report or verdict is fabricated. Roster/pin and existing progress tests run normally.
This step will be completed against the real module when it lands; callback details are in CHANGE_REQUEST.md.

## First seat win counts

Added seatWins (first physical seat wins, excluding invalid matches/draws) to every progress matchup row, overall
progress, worker metrics and /v1/playtest/run summary. Tests reconcile row totals and summaries with actual
MatchResult winners; mirror matchups are counted by seat rather than by identical hero IDs.

## Bounded replay observations

Added GET /v1/replay/:matchId/views?dataHash=<hash>&every=6. Both original and candidate versions use replayOnData
and return player-safe display observations, accumulated public events, view hashes and source/selected data pins.
Replay observers receive copies so they cannot change simulation state. Responses are bounded to 601 samples and
1 MiB; invalid intervals/unknown pins and incompatible replay frames fail explicitly. New tests cover events,
deterministic candidate playback, original hashes, privacy and size rejection.

## Solo play and lobby roster

match.start {bot:true} now fills one empty arena seat with the stable chooseActions policy; card bots use the
existing runner turn policy. Accepted bot inputs enter the same authority and replay stream. Solo results and
replay metadata carry optional botSeats; normal two-human and worker MatchResult shapes remain unchanged.
Reset removes virtual seats. New tests cover real bot uses, recording/hash replay, no-human rejection and no
replacement of connected players. Thirteen focused solo/contract/reconnect tests passed.

## Prejoin room metadata

Room status includes gameId and playableHeroes before taking a seat via /ws?roomId=... or /ws?joinCode=....
Unassociated sockets report gameId:null and an empty roster until a room is identified. Join validation uses the
actual room/content roster, while starter cards retain their existing hero-to-standard-deck compatibility.
No prejoin seat/token authority is granted; tests verify the arena and cards metadata and spectator status.

## Extended live flow

The existing socket-gated E2E scenario now also calls /v1/playtest/full without dropping its earlier pipeline,
patch, holdout or replay assertions. It checks the shared reports/changes/validation, human count, both phase
streams, first-seat counts and disjoint phase seeds, plus original/candidate replay-view responses.
Tests force analysisEnv={} so a developer's real Gemini key can never cause network calls in test runs.

## Full analysis bridge verification

Read the new full.js from the analysis worktree and adapted the bridge to its actual runFull callback API.
That file is still absent from main and this worktree. As requested, production returns 503 and its real-module
integration test remains TODO until the module lands; no synthetic report is returned.
An additional offline check used a temporary Node loader solely to import the real read-only analysis-branch
module, without copying it or adding a production fallback. The production route completed 60 baseline and
60 holdout matches across all 15 matchups, with separate phase progress, disjoint seeds, origin=fake,
humanMatches=1 and verdict=inconclusive in 3,185 ms. Candidate data stayed retained without promoting over base.
This verifies the bridge against the actual interface; it does not claim the missing main-module integration
or any TCP/WebSocket execution has passed. Temporary validation files stayed outside the repository.

## Round 6 verification

Final `node --test`: 164 passed, 0 failed, 6 unchanged socket-gated skips, 1 explicitly requested pending full.js
integration test; 49,881.446333 ms. The 100-seed determinism matrix stayed green. Focused solo/card, schema,
reconnect, pin/roster, progress/counts, replay/privacy/limits and documentation tests pass. Declarations type-check.
The API reference/captures and E2E scenario include the new full/view routes and metadata. No tests were weakened;
only the new full-module integration is pending under the user's explicit instruction.
Remaining dependency: merge packages/analysis/pipeline/full.js (and its analysis changes) into this worktree,
then regenerate examples and run the pending test without its temporary dependency gate. Real socket verification
still needs listener permission and RUN_SOCKET_TESTS=1; no networking was attempted this round.

## Polish 00:51

The earlier polish baseline was clean (153 passed, 0 failed, 6 existing socket skips); Round 6 then authorized
these feature changes. Removed unused imports, split worker/HTTP coordination into named helpers, enforced
120 columns, and preserved the stable bot API. No web files/build or render-FPS claims (web is not owned).
Measured the final runner: 300 valid matches, 15 matchups, 2 workers, 100 first-seat wins, 0 invalid;
5,900.796416 ms, 50.840595 matches/s including startup, recorded 2026-11-14T05:40:15.940Z. Actual artifacts remain
services/runner/recorded-roster-match-results.json and recorded-roster-metrics.json.
No dependencies, external calls, pushes or commits. Files are left for the external commit process.

## Polish 01:26

Rejected blank, whitespace and non-decimal PORT settings before constructing server resources. Invalid matches
now clear win/draw credit even when their terminal step succeeded before observation failed, without changing
simulation state or its hash. Added regression tests for both cases; existing assertions and gates are unchanged.

Final `node --test`: 166 passed, 0 failed, 6 existing socket-gated skips, 1 existing pending integration;
47,832.063334 ms. Both 120-column source/documentation checks and `git diff --check` pass. Reviewed console noise;
production CLI benchmark output remains intentional. No web build or render-FPS measurement (web is not owned).

Fresh benchmark: 300 valid matches across 15 matchups, 2 workers, 100 first-seat wins, 0 invalid matches;
4,636.518917 ms, 64.703715 matches/s including worker startup, recorded 2026-11-14T06:25:29.170Z.
Updated services/runner/recorded-roster-metrics.json; deterministic result data stayed unchanged.

Still blocked: packages/analysis/pipeline/full.js is absent from this worktree, so its existing integration test
remains pending. Live socket tests retain their RUN_SOCKET_TESTS=1 permission gate; no networking was attempted.
No dependencies, commits or pushes; changes are left for the external commit process.

## Polish 02:21

Already clean; no further code changes were needed after reviewing bad inputs, empty-data handling,
reconnects, persistence and replay limits. Full `node --test`: 166 passed, 0 failed, 6 unchanged socket-gated
skips, 1 existing pending integration; 47,741.785875 ms. The suite includes deterministic replay and
120-column readability checks. No dead-code or console-noise cleanup was needed; `git diff --check` passes.

Fresh measured runner: 300 valid matches across 15 matchups, 2 workers, 100 first-seat wins, 0 invalid;
5,974.436625 ms, 50.213940 matches/s including startup, recorded 2026-11-14T07:21:05.558Z.
Updated the recorded runner metrics; match results remained deterministic. No web build/FPS measurement
because the web app is outside ownership.

Still blocked: analysis pipeline full.js is absent from this worktree; its existing integration remains pending.
The six live socket tests retain their opt-in gate. No tests were weakened, skipped or deleted this pass.
No dependencies, networking, commits or pushes; leaving the report and measured metrics for external commits.

## Polish 03:21

Already clean; no additional code changes were needed after reviewing input validation, empty-data errors,
disconnect handling and persistence. Full `node --test`: 166 passed, 0 failed, 6 unchanged socket-gated skips,
1 existing pending integration; 47,639.992041 ms. Determinism and all 120-column readability checks pass.
No dead-code or console-noise changes were needed. No tests were weakened, skipped or deleted this pass.

Fresh runner measurement: 300 valid matches, 15 matchups, 2 workers, 100 first-seat wins, 0 invalid matches;
5,864.320833 ms, 51.156819 matches/s including worker startup, recorded 2026-11-14T08:21:16.585Z.
Updated recorded runner metrics; deterministic match-result data is unchanged. No web build/FPS measurement
because the web app is outside ownership.

Existing blockers remain: analysis pipeline full.js is absent here, and live socket tests require their opt-in
listener gate. No dependencies, network calls, commits or pushes. Stopping with report and metrics only.

## Polish 04:21

Already clean; no code changes needed. Reviewed input validation, empty-data and disconnect handling;
no new gaps, dead code or console noise found. Full `node --test`: 166 passed, 0 failed, 6 unchanged
socket-gated skips, 1 existing pending integration; 47,972.919042 ms. Determinism and 120-column checks pass.
No tests were weakened, skipped or deleted this pass.

Fresh runner: 300 valid matches across 15 matchups, 2 workers, 100 first-seat wins, 0 invalid;
5,875.167875 ms, 51.062371 matches/s including startup, recorded 2026-11-14T09:21:28.686Z.
Updated recorded metrics; deterministic result data stayed unchanged. Web is outside ownership, so no
web build or render-FPS measurement. Existing blockers: analysis pipeline full.js remains absent here;
live socket tests retain their opt-in listener gate. No dependencies, network, commits or pushes. Stopping.

## Polish 05:21

Already clean; no code changes needed after reviewing validation, empty-data errors, disconnects and replay
persistence. Full `node --test`: 166 passed, 0 failed, 6 unchanged socket-gated skips, 1 existing pending
integration; 49,721.493417 ms. Determinism and 120-column checks pass; no dead code or console noise found.
No tests were weakened, skipped or deleted this pass.

Fresh runner: 300 valid matches across 15 matchups, 2 workers, 100 first-seat wins, 0 invalid matches;
6,005.457792 ms, 49.954560 matches/s including startup, recorded 2026-11-14T10:21:38.205Z.
Updated recorded metrics; deterministic result data is unchanged. Web is outside ownership, so no build/FPS
measurement. Existing blockers: analysis pipeline full.js is absent here; socket tests retain their opt-in gate.
No dependencies, network calls, commits or pushes. Stopping with report and metrics only.

## Polish 06:21

Already clean; no code changes needed after reviewing bad-input validation, empty-data errors, disconnect
handling and replay persistence. Full `node --test`: 166 passed, 0 failed, 6 unchanged socket-gated skips,
1 existing pending integration; 47,718.663584 ms. Determinism and 120-column readability checks pass.
No dead code or console noise found; no tests weakened, skipped or deleted this pass.

Fresh runner: 300 valid matches across 15 matchups, 2 workers, 100 first-seat wins, 0 invalid matches;
6,385.128458 ms, 46.984176 matches/s including startup, recorded 2026-11-14T11:21:44.455Z.
Updated recorded metrics; deterministic result data stayed unchanged. Web is outside ownership, so no
web build/FPS measurement. Existing blockers: analysis pipeline full.js remains absent here; live socket
tests retain their opt-in gate. No dependencies, network calls, commits or pushes. Stopping.

## Round 7

Step 1: added scripted-0.2.0 generic discrete projectile prediction using guard startup plus four ticks.
Incoming hostile shots prioritize a legal guard; outgoing/friendly shots and guard cooldown preserve prior
behavior. No hero branches, balance data changes or bypass-trait checks. Stable bot exports remain intact.
All three bot tests pass, including every hero, unchanged observations and unavailable guards.
Follow-up: regenerate roster recordings and every derived artifact with this policy in steps 2–3 below.
No commits attempted; external committer owns git writes.

Step 2: completed 100 fixed seeds × two seats × 15 matchups (3,000 valid, 0 invalid games).
Policy scripted-0.2.0; 62,157.726875 ms, 48.264313 matches/s including two-worker startup.
Win rate is for the first named hero; draws count as games. Flag = whole Wilson 95% CI outside 45–55%.

| Matchup | Wins / games | Win rate | Wilson 95% CI | Flag |
| --- | --- | --- | --- | --- |
| bari vs daewi | 200 / 200 | 100.00% | 98.12–100.00% | yes |
| bari vs nightcrow | 200 / 200 | 100.00% | 98.12–100.00% | yes |
| bari vs real_armor | 200 / 200 | 100.00% | 98.12–100.00% | yes |
| bari vs sepia | 200 / 200 | 100.00% | 98.12–100.00% | yes |
| daewi vs nightcrow | 0 / 200 | 0.00% | 0.00–1.88% | yes |
| daewi vs real_armor | 0 / 200 | 0.00% | 0.00–1.88% | yes |
| daewi vs sepia | 0 / 200 | 0.00% | 0.00–1.88% | yes |
| nightcrow vs real_armor | 100 / 200 | 50.00% | 43.14–56.86% | no |
| nightcrow vs sepia | 100 / 200 | 50.00% | 43.14–56.86% | no |
| real_armor vs sepia | 100 / 200 | 50.00% | 43.14–56.86% | no |

Bari vs Real Armor is clearly outside the band, but seven non-mirror matchups are flagged in total.
The requested no-other-flags target is not met. No hero numbers or intended asymmetries were changed.
Follow-up for recording consistency: regenerate the runner report and room examples in step 3; the analysis
owner must regenerate packages/analysis/recorded/recorded-roster-report.json and update its policy-pinned test.

Step 3: regenerated all three services/runner/recorded-roster-* files from the same 3,000-game run, including
scripted-0.2.0 metadata and the derived analysis Report. The benchmark now regenerates its Report alongside
results and metrics. Regenerated services/room/examples.json with production handlers and the offline adapter.
The analysis-owned recorded copy and its hard-coded scripted-0.1.1 test still require the owner follow-up noted
above; no files outside ownership were changed. Older non-roster recordings remain historical, not derivatives
of this roster run. No outside network or commits.

Step 4: /v1/playtest/full now accepts optional dataHash and passes pipeline error codes/messages through HTTP.
seatWins.baseline and seatWins.holdout are numeric first-seat counts; holdout is null if no run occurred.
README and examples describe the integrated pipeline, retained-version selection and public errors.
Focused bot/full/documentation/readability tests: 15 passed, 0 failed. Added an actual pipeline-validation error
regression plus tests for retained baseline pins and public error transport; no external adapter calls.
Known full-suite blockers are analysis-owned tests: recorded.test.js compares the stale recorded report and
requests scripted-0.1.1; replay.test.js:164 expects 300 games rather than this required 3,000-game run.
Left both tests unchanged and documented precise owner follow-ups in services/room/CHANGE_REQUEST.md.

Amendment step 1: superseded 0.2.0 with scripted-0.2.1; previous step 3 artifacts do not count as final.
Exported deriveBotSeed(matchSeed, seatIndex), mixing both inputs into the project's xorshift32 stream.
Per-match draws set reaction delay (0–12), guard attempt probability (55–95%), engagement distance, strafe
and small projectile aim offsets. Each projectile receives a repeatable attempt draw from that same stream;
choices are pure under repeated observations, with no simulation RNG, clock or ambient randomness.
Runner and solo room seats now derive their policy seed from the actual match seed and seat index.
Added reproducibility/diversity/seed-validation tests; guard tests use a fixed seed with a known successful
attempt, retaining all incoming/friendly/outgoing/off-axis/cooldown assertions. Analysis replay is outside
ownership and needs the precise deriveBotSeed integration described in CHANGE_REQUEST.md. Re-measurement
and complete 0.2.1 recording/example regeneration are in progress; 0.2.0 measurements remain historical only.

Amendment step 2: completed the replacement scripted-0.2.1 run: 100 seed pairs per matchup,
3,000 valid games across 15 matchups, 0 invalid, 1,226 first-seat wins. Measured 119,026.969833 ms,
25.204372 matches/s including two-worker startup; part of this run overlapped verification tests.
Recorded at 2026-11-14T13:56:30.766Z. First-named hero win rate uses all valid games as denominator;
Wilson 95% intervals and the whole-CI-outside-45–55% rule are computed by the existing analysis package.

| Matchup | Wins / games | Win rate | Wilson 95% CI | Flag |
| --- | --- | --- | --- | --- |
| bari vs daewi | 198 / 200 | 99.00% | 96.43–99.73% | yes |
| bari vs nightcrow | 176 / 200 | 88.00% | 82.77–91.80% | yes |
| bari vs real_armor | 159 / 200 | 79.50% | 73.37–84.51% | yes |
| bari vs sepia | 176 / 200 | 88.00% | 82.77–91.80% | yes |
| daewi vs nightcrow | 33 / 200 | 16.50% | 12.00–22.27% | yes |
| daewi vs real_armor | 5 / 200 | 2.50% | 1.07–5.72% | yes |
| daewi vs sepia | 33 / 200 | 16.50% | 12.00–22.27% | yes |
| nightcrow vs real_armor | 61 / 200 | 30.50% | 24.54–37.20% | yes |
| nightcrow vs sepia | 63 / 200 | 31.50% | 25.46–38.24% | yes |
| real_armor vs sepia | 110 / 200 | 55.00% | 48.08–61.74% | no |

Rates now vary rather than collapsing to 0/50/100%. Bari vs Real Armor reaches 79.5%, but is not the
strongest outlier: Bari vs Daewi is 99%. Nine non-mirror matchups are flagged, including Daewi and the
Nightcrow/Sepia pairing. These are findings, not hidden by tuning. Hero data and bypass flaw remain unchanged.

Amendment step 3: regenerated all three recorded-roster-* artifacts with scripted-0.2.1, then regenerated
services/room/examples.json with the offline adapter and real handlers. Updated runner documentation.
The 0.2.0 recordings are superseded. Follow-up remains for the analysis-owned recorded copy, policy/count
assertions and replay adapter seed integration in CHANGE_REQUEST.md; those files were not edited.

Amendment verification: final owned-folder node:test suite has 83 passed, 0 failed, 6 unchanged socket-gated
skips; 53,761.96925 ms. This includes the 100 seeds × 1,000 active ticks × two runs hash test, worker-count
invariance, solo/runner seed agreement on every tick, full-route errors/data pins, documentation and readability.
All six bot/readability checks and the focused 14-test bot/solo/documentation group also pass. Human and solo
replays use archived accepted frames, so those replay tests remain green. E2E fake-phone drivers now derive
from match.started.config.seed and seat index as well. No tests were weakened, skipped or deleted.

The full repository run recorded 174 passed, 4 failed, 6 existing socket skips (184 tests; 54,488.443 ms).
The four failures are all analysis-owned: stale recorded-report copy/policy, the 300-vs-3,000 expected count,
and two replay/CLI-replay hash checks because arena-simulator.js still passes seat index instead of the new
exported deriveBotSeed(config.seed, seatIndex). Those assertions remain intact; do not mask the mismatch.
Follow-up is specified in services/room/CHANGE_REQUEST.md. This run preceded the final additional solo-seed
regression, which passes in the final owned suite above. No pending full.js integration remains after the merge.
Final artifact check: roster results/metrics/report share the unchanged base dataHash and scripted-0.2.1;
examples.json full response is HTTP 200 with scripted-0.2.1. git diff --check and 120-column checks pass.
No hero data changes, dependencies, outside network calls, pushes or commits were performed.

## Round 8

Measured production room pump callbacks over a ten-second window with two in-process WebSocket transports,
seed 91, Bari vs Real Armor, scripted-0.2.1 inputs. No listener or outside network was used. The match ended
at tick 437; pump timing covers the full window, including the remaining idle time. Message sizes measure
UTF-8 bytes of the complete serialized state.view envelope, including events, excluding WebSocket/TCP headers.

| Measurement | Before: setInterval | After: monotonic deadline scheduler |
| --- | --- | --- |
| Window (ms) | 10,001.108 | 10,000.723 |
| Pump intervals sampled | 1,135 | 1,231 |
| Pump interval min / avg / max (ms) | 7.115 / 8.800 / 14.141 | 2.363 / 8.118 / 24.539 |
| Active step interval min / avg / max (ms) | 8.139 / 16.661 / 25.600 | 7.005 / 16.658 / 31.426 |
| state.view messages | 876 | 876 |
| state.view bytes min / avg / max | 947 / 1,062.932 / 1,515 | 947 / 1,062.932 / 1,515 |

Replaced the 8 ms setInterval with monotonic, deadline-based setTimeout scheduling. It skips stale callback
deadlines instead of bursting callbacks and cancels cleanly, including shutdown inside a callback. The existing
60 Hz fixed-step simulation accumulator is unchanged; scheduling time never enters simulation state. Drift is
corrected, but OS/event-loop jitter still exists (the measured maximum is higher in this sample). No protocol
changes. Reproduce the post-change measurement with `node services/room/measure-timing.js`; all writes are temp.

Shutdown follow-up: close() now calls http.closeAllConnections() before http.close(). SIGINT/SIGTERM arms a
three-second deadline that prints a readable message and forces exit code 1 if close has not completed;
completed shutdown cancels it, and repeated signals do not rearm it. Added tests for HTTP close order,
forced-exit timing, deadline cancellation, scheduler drift/late callbacks and cancellation.

Verification: services/room plus services/runner node:test suite: 51 passed, 0 failed, 5 unchanged socket-gated
skips; 11,415.332167 ms. Focused scheduler/startup/readability suite: 11 passed, 0 failed. Source/documentation
120-column checks and git diff --check pass. Existing Round 7 analysis-owned recording/replay follow-ups remain
outside ownership. No tests weakened, dependencies, network calls, pushes or commits.

## Round 8 versions

Step 1: added an atomic JSON version ledger at data/versions/<gameId>.json within the configured storage
root. Original data receives an approved base root; apply-patch and full runs retain parent hashes, numeric
changes, rationale and available target/verdict summaries. Content hashes identify records; no-op/repeated
content keeps the existing record rather than overwriting its provenance. Branches retain their shared parent.
Version metadata is separate from immutable GameData files. Reused the existing atomic writer via files.js.
Tests cover roots, branching, approval persistence/restart, retained base data and full-run parent/target data.

Step 2: added GET /v1/versions/:gameId, GET /v1/versions/:gameId/:hash, POST approval and POST current-version
selection. Detail responses flatten the shared record and add diff; approval takes {} and never selects data.
Selection atomically changes only the server-wide current pin, preserving retained data and existing room pins.
Tests exercise every route, persistence/restart, missing hashes, cross-game pins and malformed input without
state mutation. Initial version/persistence group: 8 passed, 0 failed; full/persistence group: 11 passed, 0 failed.

Current step clean point: final service/runner/E2E discovery run has 62 passed, 0 failed, 7 socket-gated skips
(5 room tests and 2 E2E scenarios), no TODO; 11,313.999083 ms. The focused version/auto group has 11 passed.
Only the new analysis runAuto boundary is stubbed by explicit injection; real workers/storage/routes are used.
Current /auto wiring follows Tony's FINAL interface, but the real module is absent until main 1736a3a is merged.
The README/example-capture updates and real runAuto integration verification are not finished. Detailed file,
function, interface, route and test handoff is in services/room/HANDOFF.md. No further feature edits started.
Stopping at Tony's request for an outside commit/merge and continuation by another agent. No commits or network.

### Round 8 continuation (handoff steps 1–8)

- Main (with the real packages/analysis/pipeline/auto.js, per-hero rounds) merged into jokerstar/engine.
- Bug fixed (versions.js): a repeated record returned the stored one unchanged, so the analysis final roster
  check's downgrade to rejected was dropped and a regressed version stayed approved. A repeat may now only
  downgrade to rejected; provenance and approval are never rewritten or upgraded. Test: versions.test.js
  "a later rejection of a stored version is kept; a repeat can never upgrade it" (failed before the fix).
- Interface check against the real runAuto: allMatchups as sorted "a vs b" strings incl. mirrors matches; progress
  is reported before each runBatch; the final check uses round rounds+1 and phase final_check, within the engine's
  bounds (round ≤ rounds+1, seed slot 6).
- auto-real.test.js: real runAuto through POST /v1/playtest/auto, fake adapter, real workers, temp storage. It
  asserts parent chaining, ledger = response, no live-LLM origin, approval-required leaves records unapproved,
  auto never selects. Opt-in (RUN_REAL_AUTO=1) because it measured 510 s total (rounds:2 ≈ 364 s, rounds:1 ≈ 147 s)
  on this laptop; it passed 2/2 when run.
- README "Round 8 versions" documents the five routes; examples.json regenerated with versions, version, approve,
  select and autoInvalid captures; documentation.test.js asserts them.
- Verification: node --test → 231 tests, 222 pass, 0 fail, 9 opt-in skips. Socket/E2E (RUN_SOCKET_TESTS=1) could not
  run here: listen EPERM on 127.0.0.1 in this sandbox. Not verified: the two E2E scenarios and room TCP tests.
- Limits: a live auto run takes minutes, so the 2-minute demo should use a recorded history. The 400 message for
  a bad /auto body mentions actions.available, which is misleading for an HTTP route (not changed).

## Held movement (controls fix)

Problem: the sim moves a hero only on ticks whose frame holds a move input, the phone sends one about every 33 ms,
and the
room kept no held input, so a held stick moved the hero on about half the ticks and stopped on any Wi-Fi gap.

Fix: `Authority` (packages/sim) keeps each human seat's last accepted non-zero move vector (`holdMoves` lists the
seats;
bots are not listed because they send a move every tick). On every authoritative tick where that seat has no new
move,
`advance` adds a server-generated move with that vector to the frame. It is recorded in the accepted frame history,
so
replays and MatchResults stay deterministic, and it makes no receipt and no change to the seat's sequence numbers.
- Cleared by: a `(0, 0)` move, a disconnect (`server.disconnect` calls `authority.release`), a stun or KO (the pure-
  copy legality check fails, so the hold ends), and the end of the match.
- Never carries an attack. If the seat sends an attack on the same tick, the held move uses the sequence number just
  below it.
- Rule change in the arena step: a `move` may repeat the seat's latest sequence number (`>=`; other actions still
  need `>`). Only the server can do this, because `Authority.submit` still requires strictly rising sequence
  numbers. Old recordings are unaffected (their sequence numbers always rise). `simVersion` is unchanged on purpose;
  the integrator may bump it.
- Tests: `services/room/held-move.test.js` (8): silence keeps moving every tick, `(0, 0)` stops, a new vector
  replaces the old one, no attack is carried and sequence numbers stay valid, stun stops it, bots and match end,
  replay reproduces the final hash, and a room test where a disconnect stops a held stick.
