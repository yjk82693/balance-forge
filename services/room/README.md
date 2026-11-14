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
  "roomId": "3012328c-8d90-45d4-8562-672eb502a55a",
  "joinCode": "DMES",
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
  "resultsPath": "/v1/playtest/results/2eda5c48-253b-49ae-9641-0d4ae8b5aa37.json",
  "elapsedMs": 111.77195800000001,
  "matchCount": 2,
  "dataHash": "9fc13bd06787c053adc2db4ef47b1ef65adf465657b3e462e7e4cffd627226c2",
  "recorded": true
}
```

Connected sockets receive playtest.progress while the HTTP request waits for completion.

### GET /v1/playtest/results/:id.json

Example: `curl -sS "$BASE/v1/playtest/results/2eda5c48-253b-49ae-9641-0d4ae8b5aa37.json"`

200: the exact MatchResult array. Full body: examples.json → http.results. First result excerpt:

```json
{
  "matchId": "bot-2eda5c48-253b-49ae-9641-0d4ae8b5aa37-1",
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

Example: `curl -sS "$BASE/v1/replay/human-16206091-21a5-4765-866a-76ae742ea4d4"`

200: {matchId, seed, config, frames, finalStateHash}, only for archived matches; unknown IDs return 404.
Accepted frames include neutral ticks and authoritative timeouts; rejected controller arrivals are excluded.
Response excerpt (complete: examples.json → http.replay):

```json
{
  "matchId": "human-16206091-21a5-4765-866a-76ae742ea4d4",
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
  "roomId": "d68ddcf2-b269-417c-b85a-f2dc99918c26",
  "sessionId": "8076dd57-38ac-4462-b692-e57126b2cafe",
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
  "joinCode": "K3NM",
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
  "joinCode": "K3NM",
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
  "joinCode": "K3NM",
  "phase": "lobby",
  "gameId": "hero_arena",
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
    "matchId": "human-16206091-21a5-4765-866a-76ae742ea4d4",
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
  "runId": "2eda5c48-253b-49ae-9641-0d4ae8b5aa37",
  "gameId": "hero_arena",
  "dataHash": "9fc13bd06787c053adc2db4ef47b1ef65adf465657b3e462e7e4cffd627226c2",
  "matchesDone": 2,
  "totalMatches": 2,
  "elapsedMs": 112,
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
