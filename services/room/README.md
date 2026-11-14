# Room service

Start from the repository root with `node services/room/cli.js`. HOST defaults to 0.0.0.0 and PORT to 3000.
The same port serves apps/web/dist, HTTP APIs, and /ws. The web owner supplies the built UI and socket transport.

A display connects to /ws?role=display&gameId=hero_arena (or hero_cards), receives room.status, and owns start/reset.
Phones connect to /ws and send room.join {joinCode, name, hero}. The server sends their seat as `you`.
Use the standard envelope with the current roomId/sessionId/epoch. Inputs target the next authoritative tick.
Arena accepts one move and one aimed attack per seat/tick, using distinct increasing input sequence values.
Movement is not an attack metric. actions.available is the authoritative action catalog for that seat.

The joining phone also receives a private seatToken. Keep it locally; do not put it in public links or reports.
After disconnect, reconnect within 10 seconds and send:

```json
{"joinCode":"AB23","seatToken":"<private token>","lastAck":42}
```

Use envelope type `reconnect`. A successful reply keeps the same seat/hero/match and rotates the token.
The server resends config/current view and the requested previous receipt if available. Sequences stay monotonic;
duplicate accepted sequences retain their original receipt. At exactly 10 seconds, the token expires.
Disconnected players receive neutral realtime inputs or authoritative card timeouts; new players cannot replace
an existing player mid-match. Reset returns connected players to a clean lobby and increments the epoch.

HTTP endpoints:

- GET /v1/games: game descriptors.
- POST /v1/rooms {gameId}: roomId/joinCode/hostToken for an HTTP-created room.
- GET /v1/data/:gameId: current immutable GameData and dataHash.
- GET /v1/data/:gameId?dataHash=<hash>: a retained content version.
- POST /v1/data/:gameId/apply-patch {proposal}: validated numeric patch, retaining both versions.
- POST /v1/playtest/run {gameId, pairs}: paired-seed worker run, returning resultsPath and elapsedMs.
- GET the returned resultsPath: unchanged MatchResult array. The default matchup remains Bari/Real Armor.
- GET /v1/replay/:matchId: archived seed/config/accepted frames/finalStateHash for a finished human or HTTP bot match.

While a playtest runs, connected sockets receive `playtest.progress` immediately, about every 100 ms, and at
completion. Payload: runId, gameId, dataHash, matchesDone, totalMatches, elapsedMs, matchups. Each matchup row
contains heroes, wins by hero/deck ID, valid games, draws and invalidMatches. This does not alter final results.

state.view includes ordered transient events: combat.hit, combat.guard, combat.ko, projectile.spawn and
projectile.expire. Event IDs use tick/ordinal; expiry reason is hit/lifetime/bounds. Only the intended viewer
receives private card.peek events. A reconnect view does not repeat earlier transient events.

Human results are recorded in human-results.json. Replays and immutable versions live in replays/ and data/;
HTTP bot results and metadata live in playtests/. Tokens/names are not included in replay/config/result records.
Result saves use atomic replacement. Transient write failures queue a retry and send an explicit error; a saved
match.ended notification is delayed until recording succeeds. Restart does not preserve live rooms.

`replayOnData(adapter, recording, candidateData)` in packages/sim reuses accepted inputs with a different content
pin. An illegal counterfactual input is an explicit failure; it is never silently turned into neutral input.
Exact original playback verifies finalStateHash. Candidate hash comparisons must stay within that content pin.

Tests without network: `node --test`. This runs real workers and persistence with in-memory production handlers.
Five live TCP/WebSocket tests require external permission and explicit opt-in:
`RUN_SOCKET_TESTS=1 node --test services/room/room.test.js`.
See REPORT.md for actual pass/skip counts, measured throughput, and the earlier sandbox listener restriction.
