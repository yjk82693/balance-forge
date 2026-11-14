# Room service protocol

Start from the repository root: `node services/room/cli.js`.

HOST defaults to 0.0.0.0; PORT defaults to 3000. A busy port produces a readable stderr message and exit code 1.
GET /v1/games is registered before listening; the demo launcher can use it as a readiness probe.
One port serves apps/web/dist, HTTP APIs and /ws. The web owner supplies the built app and client transport.

## Reading the examples

Every implemented HTTP route and application WebSocket message has an example below. Complete requests/responses
and full envelopes are captured in [examples.json](examples.json). Large bodies below are labelled excerpts:
omitted fields are still required. Captures use production handlers and real workers without network, including
a two-tick illustrative human match; these are protocol examples, not demo balance evidence.
Captured room/session/match IDs are illustrative. Tokens are redacted; replace them with your client's actual
values. Regenerate the capture with `node services/room/generate-examples.js`.

For curl examples set `BASE=http://localhost:3000`, `GAME=hero_arena`, and HASH to a hash returned by GET data.
hero_cards is also supported. Substitute returned paths, IDs, hashes and tokens when following the examples.

## HTTP routes

### GET /v1/games

Example: `curl -sS "$BASE/v1/games"`

200: GameDescriptor array, including titleKey, mode, player limits and the full closed action parameter schemas.
Response excerpt (complete: examples.json → http.games):

```json
[
  {
    "gameId": "hero_arena",
    "mode": "realtime",
    "minPlayers": 2,
    "maxPlayers": 2
  },
  {
    "gameId": "hero_cards",
    "mode": "turn",
    "minPlayers": 2,
    "maxPlayers": 2
  }
]
```

### POST /v1/rooms

Example: `curl -sS -H 'content-type: application/json' -d '{"gameId":"hero_arena"}' "$BASE/v1/rooms"`

201 response; gameId is optional and defaults to hero_arena:

```json
{
  "roomId": "22d3e7dc-990b-4293-a4f3-32531218dc24",
  "joinCode": "QLB3",
  "hostToken": "REDACTED_PRIVATE_HOST_TOKEN_00000000",
  "epoch": 1
}
```

The host attaches to /ws?roomId=<roomId>&hostToken=<hostToken>. Keep the host token private.

### GET /v1/data/:gameId

Example: `curl -sS "$BASE/v1/data/$GAME"`

200: {data, dataHash}. data is the complete immutable GameData. Response excerpt:

```json
{
  "dataHash": "babbaeabf8563c373ee3a5518fb0810f576b793fba1f61e9c914cf71a55725cd"
}
```

The same route accepts a retained hash: `curl -sS "$BASE/v1/data/$GAME?dataHash=$HASH"`.
Full 200 bodies: examples.json → http.data and http.retainedData. Each data body hashes to its dataHash.

### POST /v1/data/:gameId/apply-patch

Example:

```sh
curl -sS -H 'content-type: application/json' --data @patch-request.json   "$BASE/v1/data/$GAME/apply-patch"
```

patch-request.json contains this exact request body; use your own retained base hash:

```json
{
  "proposal": {
    "baseDataHash": "babbaeabf8563c373ee3a5518fb0810f576b793fba1f61e9c914cf71a55725cd",
    "replacements": [
      {
        "path": "/moves/1/power",
        "value": 72
      }
    ],
    "rationale": "Protocol example only; not a balance recommendation."
  }
}
```

200 response:

```json
{
  "dataHash": "9fc13bd06787c053adc2db4ef47b1ef65adf465657b3e462e7e4cffd627226c2",
  "baseDataHash": "babbaeabf8563c373ee3a5518fb0810f576b793fba1f61e9c914cf71a55725cd"
}
```

Both versions are retained; existing matches keep their original pin. Only bounded allowlisted numeric fields
can change. Identity, schema, author/license and executable code changes are rejected.

### POST /v1/playtest/run

Example:

```sh
curl -sS -H 'content-type: application/json' -d '{"gameId":"hero_arena","pairs":1}'   "$BASE/v1/playtest/run"
```

pairs is an integer 1..1000. Each seed runs twice with swapped assignments. The default arena matchup remains
Bari/Real Armor; cards defaults to two standard decks. A concurrent run returns RATE_LIMITED.
200 response; elapsedMs is from this capture's actual worker run, not a performance guarantee:

```json
{
  "resultsPath": "/v1/playtest/results/9d14df30-71cb-49c7-b7e0-a7f06f1c7de7.json",
  "elapsedMs": 130.04091599999998,
  "matchCount": 2,
  "dataHash": "9fc13bd06787c053adc2db4ef47b1ef65adf465657b3e462e7e4cffd627226c2",
  "recorded": true,
  "seatWins": 0
}
```

Connected sockets receive playtest.progress while the HTTP request waits for completion.

### GET /v1/playtest/results/:id.json

Example: `curl -sS "$BASE/v1/playtest/results/9d14df30-71cb-49c7-b7e0-a7f06f1c7de7.json"`

200: the exact MatchResult array. Full body: examples.json → http.results. First result excerpt:

```json
{
  "matchId": "bot-9d14df30-71cb-49c7-b7e0-a7f06f1c7de7-run-1",
  "outcome": {
    "status": "win",
    "winners": [
      "p2"
    ],
    "reason": "hp_zero"
  },
  "valid": true,
  "errorCode": ""
}
```

Each complete result also includes config, statistics and finalStateHash. Invalid matches never count as draws.

### GET /v1/replay/:matchId

Example: `curl -sS "$BASE/v1/replay/human-29552fda-b39d-4f9b-9c37-30d0f45f7a4d"`

200: {matchId, seed, config, frames, finalStateHash}, only for archived matches; unknown IDs return 404.
Accepted frames include neutral ticks and authoritative timeouts; rejected controller arrivals are excluded.
Response excerpt (complete: examples.json → http.replay):

```json
{
  "matchId": "human-29552fda-b39d-4f9b-9c37-30d0f45f7a4d",
  "seed": 1,
  "frames": [
    {
      "tick": 1,
      "actions": [
        {
          "playerId": "p1",
          "seq": 0,
          "tick": 1,
          "turnId": 0,
          "actionId": "move",
          "params": {
            "moveX": 1000,
            "moveY": 0
          }
        }
      ],
      "systemInputs": []
    },
    {
      "tick": 2,
      "actions": [],
      "systemInputs": []
    }
  ]
}
```

Use packages/sim replayOnData with the retained base/candidate content. Incompatible or illegal counterfactual
inputs fail explicitly; they are never silently replaced. Original playback must reproduce finalStateHash.

### GET /*

Example: `curl -sS "$BASE/"`

Static files come from apps/web/dist; extensionless routes such as /lobby fall back to index.html. Content type
follows the file extension. This capture uses a temporary example index, with this complete 200 text/html body:

`<h1>Protocol example</h1>`

Missing assets return 404; absent web build returns 503. Paths escaping the static root are rejected.

### HEAD /*

Example: `curl -I "$BASE/"`

200 with the same content type and an empty body. Complete capture: examples.json → http.staticHead.

### GET /ws — WebSocket upgrade

Example:

```js
new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws?role=display&gameId=hero_arena');
```

A valid upgrade returns HTTP 101 Switching Protocols, followed by the application envelopes below; it is not a
JSON GET route. /ws?role=display creates a host room. Phones use /ws and join by code. Additional displays use
/ws?roomId=<roomId> read-only. An HTTP-created host uses /ws?roomId=<roomId>&hostToken=<hostToken>.
Real TCP upgrades are covered by opt-in tests, not the offline capture.

## WebSocket envelope

All messages have these fields. This is a captured input.submit envelope; use your latest server-issued
roomId/sessionId/epoch and your own requestId/seq. The message examples below show payloads only.

```json
{
  "protocolVersion": "0.1",
  "type": "input.submit",
  "roomId": "eeb37e35-e76f-4753-8291-9a7cac310140",
  "sessionId": "502aaae8-809f-4eab-a431-3747dff074dc",
  "requestId": "r12",
  "seq": 12,
  "epoch": 2,
  "payload": {
    "playerId": "p1",
    "seq": 0,
    "tick": 1,
    "turnId": 0,
    "actionId": "move",
    "params": {
      "moveX": 1000,
      "moveY": 0
    }
  }
}
```

Input seq is per seat and monotonic; it need not match the envelope seq. Arena allows one move plus one attack
per tick with distinct increasing sequences. Inputs target latest state.view.tick + 1 and the current turnId.
A duplicate accepted sequence returns its original receipt. Rejected input never advances simulation state.

## Client messages

### room.create — client to server

Creates a host room on an unattached socket; replies with room.status. gameId is optional.

```json
{
  "gameId": "hero_cards"
}
```

### room.join — client to server

Joins in the lobby; replies with room.status, your seat and a private token. Plain disconnect leaves.

```json
{
  "joinCode": "5XS5",
  "name": "Two",
  "hero": "real_armor"
}
```

### game.select — client to server

Host-only lobby game/content selection; dataHash is optional. Replies with room.status.

```json
{
  "gameId": "hero_arena",
  "dataHash": "babbaeabf8563c373ee3a5518fb0810f576b793fba1f61e9c914cf71a55725cd"
}
```

### match.start — client to server

Host-only, requires two connected seats. Replies with room.status, match.started and initial views.

```json
{
  "seed": 1,
  "maxTicks": 2
}
```

### input.submit — client to server

Seat-bound ActionInput; replies with input.ack or error. Movement consumes no attack cooldown/statistic.

```json
{
  "playerId": "p1",
  "seq": 0,
  "tick": 1,
  "turnId": 0,
  "actionId": "move",
  "params": {
    "moveX": 1000,
    "moveY": 0
  }
}
```

### match.reset — client to server

Host-only; resets simulation/receipts, increments epoch and replies with lobby room.status.

```json
{}
```

### reconnect — client to server

Resumes a disconnected seat within ten seconds. Rotates token and resends pinned config/current view.

```json
{
  "joinCode": "5XS5",
  "seatToken": "REDACTED_PRIVATE_SEAT_TOKEN_00000000"
}
```

### ping — client to server

Health request; replies with pong. No simulation effect.

```json
{}
```

For reconnect, lastAck is optional and requests a previous accepted receipt. The same resume can use room.join
with seatToken. At exactly ten seconds the token expires; another phone cannot replace a player mid-match.
Resuming keeps hero/deck, match, content pin and monotonic sequence receipts.

## Server messages

### room.status — server to client

Room code, phase, game and seats. you/seatToken appear only for their owner.

```json
{
  "joinCode": "5XS5",
  "phase": "lobby",
  "gameId": "hero_arena",
  "playableHeroes": [
    "bari",
    "real_armor",
    "daewi",
    "sepia",
    "nightcrow"
  ],
  "seats": [
    {
      "seat": "p1",
      "name": "One",
      "hero": "bari",
      "connected": true
    },
    {
      "seat": "p2",
      "name": "Two",
      "hero": "real_armor",
      "connected": true
    }
  ],
  "you": "p2",
  "seatToken": "REDACTED_PRIVATE_SEAT_TOKEN_00000000"
}
```

### match.started — server to client

Exact pinned MatchConfig for the match.

```json
{
  "config": {
    "contractVersion": "0.1",
    "schemaVersion": 1,
    "gameId": "hero_arena",
    "simVersion": "arena-0.1.1",
    "dataHash": "babbaeabf8563c373ee3a5518fb0810f576b793fba1f61e9c914cf71a55725cd",
    "seed": 1,
    "players": [
      "p1",
      "p2"
    ],
    "mode": "realtime",
    "maxTicks": 2,
    "options": {
      "assignments": {
        "p1": "bari",
        "p2": "real_armor"
      }
    }
  }
}
```

### input.ack — server to client

Accepted receipt. Envelope seq echoes ActionInput.seq; acceptedTick is authoritative.

```json
{
  "seq": 0,
  "status": "accepted",
  "acceptedTick": 1
}
```

### state.view — server to client

Seat-safe observation, tick, turnId, epoch, viewHash and ordered events. Response excerpt:

```json
{
  "tick": 1,
  "turnId": 0,
  "epoch": 2,
  "viewHash": "e60180e7f200522153a4c60fa6c4881172f678ee50f970417ee6ff856d5bf668",
  "events": []
}
```

### actions.available — server to client

Current legal actions, playerId/tick/turnId. Response excerpt selecting only the move action:

```json
{
  "playerId": "p1",
  "tick": 1,
  "turnId": 0,
  "actions": [
    {
      "actionId": "move",
      "labelKey": "action.move",
      "control": "axes",
      "paramsSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "moveX": {
            "type": "integer",
            "minimum": -1000,
            "maximum": 1000
          },
          "moveY": {
            "type": "integer",
            "minimum": -1000,
            "maximum": 1000
          }
        },
        "required": [
          "moveX",
          "moveY"
        ]
      }
    }
  ]
}
```

### match.ended — server to client

Saved MatchResult in result; excerpt below. Full config/statistics/hash are in examples.json:

```json
{
  "result": {
    "matchId": "human-29552fda-b39d-4f9b-9c37-30d0f45f7a4d",
    "outcome": {
      "status": "draw",
      "winners": [],
      "reason": "max_ticks"
    },
    "valid": true,
    "errorCode": ""
  }
}
```

### playtest.progress — server to client

Initial, approximately 100 ms, and final worker progress. Counts below come from the captured run:

```json
{
  "runId": "9d14df30-71cb-49c7-b7e0-a7f06f1c7de7",
  "gameId": "hero_arena",
  "dataHash": "9fc13bd06787c053adc2db4ef47b1ef65adf465657b3e462e7e4cffd627226c2",
  "matchesDone": 2,
  "totalMatches": 2,
  "seatWins": 0,
  "elapsedMs": 130,
  "matchups": [
    {
      "matchup": "bari vs real_armor",
      "heroes": [
        "bari",
        "real_armor"
      ],
      "wins": {
        "bari": 1,
        "real_armor": 1
      },
      "games": 2,
      "seatWins": 0,
      "draws": 0,
      "invalidMatches": 0
    }
  ]
}
```

### pong — server to client

Health reply; requestId copies the ping requestId.

```json
{}
```

### error — server to client

Stable code/message/requestId/retryable. This example rejects an unsupported application message:

```json
{
  "code": "INVALID_SCHEMA",
  "message": "Invalid message shape or parameter. Check actions.available for the current action domain.",
  "requestId": "r20",
  "retryable": false
}
```

The complete state.view observation in examples.json includes bounded arena entities/projectiles. Cards expose
only the viewer's hand/peek; full state, private RNG and opponent deck order are never sent.
Events use tick/ordinal IDs: combat.hit, combat.guard (activate/block), combat.ko, projectile.spawn and
projectile.expire (hit/lifetime/bounds). Private card.peek events go only to their audience. Reconnect does not
repeat earlier transient events. Browser controls must honor actions.available.

## Errors and persistence

Maximum envelope is 64 KiB, nesting 32, inputs 120 submissions/s/seat. Bad JSON/shape/domain yields INVALID_SCHEMA;
bad seat/action ILLEGAL_ACTION; wrong tick LATE_INPUT; wrong turn/epoch STALE_TURN; invalid/expired token
AUTH_EXPIRED; full room ROOM_FULL; throttling RATE_LIMITED. Version/hash/patch errors have VERSION_MISMATCH,
HASH_MISMATCH or PATCH_REJECTED. HTTP failures use {code, message} and 400/403/429/503; unknown routes/results
return 404 with a code. Only listed routes/messages are implemented; proposed RTC/handoff endpoints are not.

Human MatchResult arrays are in human-results.json; frames in replays/, content in data/, bot results in playtests/.
Names/tokens are not recorded with configs/results/replays. Versions are immutable. Atomic result-write failures
queue retries and delay match.ended until saving succeeds. Reset/shutdown aborts unfinished games as invalid,
never draws. Restart does not preserve live rooms.

## Verification

`node --test` runs real workers, persistence and production handlers without network. Five existing TCP tests
require external listener permission: `RUN_SOCKET_TESTS=1 node --test services/room/room.test.js`.
Those tests enforce catalog readiness within one second after listening. See REPORT.md for actual verification.

## Round 6 dashboard additions

### POST /v1/playtest/full

```sh
curl -sS -H 'content-type: application/json' \
  -d '{"gameId":"hero_arena","roster":true,"pairs":50,"holdoutPairs":50}' "$BASE/v1/playtest/full"
```

pairs and holdoutPairs default to 50; roster defaults to false. The response contains runId, gameId, elapsedMs,
botPolicyVersion, seedSetId, holdoutSeedSetId, baseline Report, proposal with origin/changes, validation, patched
Report/dataHash, verdict and humanMatches. The seatWins summary contains numeric baseline/holdout first-seat
counts; holdout is null when no holdout ran. Optional dataHash selects a retained baseline data version.
Baseline seeds 1..pairs never overlap holdout 1000001..1000000+holdoutPairs. Both streams include phase equal to
baseline or holdout. Candidates are retained by hash without automatically replacing the current baseline.
Production selects Gemini when GEMINI_API_KEY is set, otherwise fake; tests explicitly pass an empty adapter env.

The analysis full.js module is integrated. Pipeline failures retain their public code and readable message,
for example HTTP 400 {"code":"SIMULATION_FAILED","message":"The holdout run could not complete."}.
The full captured success response is in examples.json → http.full.

/v1/playtest/run additionally accepts roster:true and dataHash to scan all roster matchups or a retained version:

```sh
curl -sS -H 'content-type: application/json' \
  -d '{"gameId":"hero_arena","pairs":1,"roster":true}' "$BASE/v1/playtest/run"
```

Its seatWins is the number of valid matches won by config.players[0], not hero wins. Every progress matchup row
also has seatWins, so mirror cells can display physical-seat advantage without inventing a hero winner.

### GET /v1/replay/:matchId/views

```sh
curl -sS "$BASE/v1/replay/$MATCH_ID/views?every=6"
curl -sS "$BASE/v1/replay/$MATCH_ID/views?dataHash=$PATCHED_HASH&every=6"
```

200: {matchId, gameId, seed, sourceDataHash, dataHash, every, views, finalStateHash}. Each view contains tick,
observation, accumulated public events and viewHash. Full captured example: examples.json → http.views.
Original playback verifies the recorded final hash; candidates use the same accepted frame stream. Invalid or
incompatible replay inputs return an explicit error. Private cards/RNG are excluded. At most 601 views and 1 MiB
are returned; use a larger sampling interval if RATE_LIMITED rejects an oversized request.

### Solo start and prejoin picker

A phone can inspect status before joining by connecting to /ws?joinCode=<code> or /ws?roomId=<id>. Status includes
actual gameId and playableHeroes; an unassociated /ws reports gameId:null and an empty roster until identified.
The same authority checks hero selection against that roster. Cards retain starter-hero compatibility.

After one human phone joins, the host can send match.start payload {"bot":true}. The empty seat is filled by the
standard bot, exposed as bot:true in that seat's status; results/replays mark botSeats:["p2"] (or the actual bot
seat). Normal two-human/worker results omit botSeats. Reset drops the virtual seat; no human seat is replaced.

## Round 8 versions

Every retained data hash has one version record in data/versions/<gameId>.json under the storage root:
{dataHash, parentHash|null, gameId, createdAt, origin, changes[{path,label?,old,new}], rationale, target|null,
verdict|null, approved, note?}. The base data is the approved root. Nothing is deleted; revert = select an older
hash. A repeated record never rewrites provenance or approval; the only change a repeat can make is a downgrade
to rejected (the analysis final roster check uses this when a later scan shows a regression).

### GET /v1/versions/:gameId

Example: `curl -sS "$BASE/v1/versions/$GAME"` → 200 `{versions, currentHash}`: `versions` is the array of records,
oldest first, and `currentHash` is the server-wide current version (what "Make current" changes).
Captured: http.versions.

### GET /v1/versions/:gameId/:hash

Example: `curl -sS "$BASE/v1/versions/$GAME/$HASH"` → 200 record plus diff (numeric changes vs parent).
Unknown hash: 400 HASH_MISMATCH. Captured: http.version.

### POST /v1/versions/:gameId/:hash/approve

```sh
curl -sS -H 'content-type: application/json' -d '{}' "$BASE/v1/versions/$GAME/$HASH/approve"
```

Body must be {}. Returns the approved record. Approval never selects data. A record whose verdict is `rejected` cannot
be approved (400 ILLEGAL_ACTION). Captured: http.approve.

### POST /v1/data/:gameId/select

```sh
curl -sS -H 'content-type: application/json' -d "{\"dataHash\":\"$HASH\"}" "$BASE/v1/data/$GAME/select"
```

200 `{versions, currentHash}`, the same shape as GET /v1/versions/:gameId, with `currentHash` now the selected hash.
Changes only the server-wide current version; rooms keep their own game.select pins. Captured: http.select.

### POST /v1/playtest/auto

```sh
curl -sS -H 'content-type: application/json' \
  -d '{"gameId":"hero_arena","rounds":2,"requireApproval":true}' "$BASE/v1/playtest/auto"
```

Body: gameId, optional fromHash (a recorded version), rounds 1–5 (default 3), requireApproval (default true).
Runs the analysis runAuto: scan, one targeted patch per round, fresh holdout seeds, verdict, then one final roster
check. 200 {records, stoppedBecause, finalCheck, headHash, runId, gameId[, error]}; stoppedBecause is one of
fair, not_accepted, regression, rounds, awaiting_approval, error. playtest.progress messages carry round and phase
(scan, holdout, final_check). Shares the run/full lock: a second concurrent run gets RATE_LIMITED. A real run with
five heroes takes minutes (the opt-in integration test measured about 6 minutes for rounds:2), so examples.json
captures only request validation (http.autoInvalid, 400 INVALID_SCHEMA for rounds:9). Real-module coverage:
`RUN_REAL_AUTO=1 node --test services/room/auto-real.test.js`.
