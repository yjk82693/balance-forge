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
card; revealed next-card identity is private to its owner and expires on the next draw. No boosted matchup rule.
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
