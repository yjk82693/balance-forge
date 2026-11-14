# Change requests from apps/web

Checked against `services/room` on the `engine` branch (06860c2), running locally. The web side was fixed wherever the
server's behaviour is clear; the items below need an engine decision. The first round of requests (hero on seats,
`you`, `room.join`, `match.reset`, action catalog, `maxHp`) were accepted in the v0.1.1 addendum and match the server.

## For the engine (`services/room`, `packages/games`)

1. **Replay views for the side-by-side compare.** `GET /v1/replay/:matchId` returns `{matchId, seed, config, frames,
   finalStateHash}` where `frames` are accepted *input* frames. The browser cannot re-simulate them
   (`packages/contracts` imports `node:crypto` and `node:fs`). Please add something like
   `GET /v1/replay/:matchId/views?dataHash=<hash>&every=6` that returns Observations (or `state.view` payloads with
   `events`) for the original data and, with `dataHash`, for a patched version via `replayOnData`. Until then the
   compare view shows an illustrative replay and only takes the seed from the stored replay.
2. **Patch proposal and verification over HTTP.** `POST /v1/playtest/run` returns only
   `{resultsPath, elapsedMs, matchCount, dataHash, recorded}`. The dashboard needs, from the analysis side:
   a proposal (`PatchProposal`, `origin: gemini|fallback|manual`, validation result, optional per-field old values
   `changes: [{path, label?, old?, new}]`) and a verdict for a rerun on the patched `dataHash`. Suggested:
   `POST /v1/playtest/propose {gameId, resultsPath}` and `POST /v1/playtest/run` accepting an optional `dataHash`
   (the body schema is closed today, so it is rejected).
3. **15 matchups.** `/v1/playtest/run` always runs the default Bari/Real Armor pairing (`pairedJobs`). `rosterJobs`
   (all hero pairs including mirrors) exists but is not reachable; please add `roster: true` to the run body.
4. **Mirror matchups.** A hero's win counter cannot be split by seat, so `bari vs bari` shows every game as a win.
   Please add seat-based wins (`seatWins`: games won by the first seat) to each `matchups` row of `playtest.progress`
   and to the stored results summary. The UI already reads `seatWins` when present and hides mirror rows otherwise.
5. **One human against a bot.** `match.start` needs exactly two connected seats (`ILLEGAL_ACTION` otherwise), so the
   lobby asks for two phones. A solo demo needs a bot seat (for example `match.start {gameId, bot: true}`).
6. **Report extras.** `humanMatches` (count from `human-results.json`), `botPolicyVersion`, `seedSetId` and `runId`
   are not in the run reply; the web fills placeholders (`botPolicyVersion: "scripted"`, `seedSetId: "pairs-N"`).
7. **Small:** `room.status` for a phone before it joins has `joinCode: ""`; the join form therefore cannot tell
   whether Nightcrow is playable in this room. The web enables all five heroes in the picker.

## For the integrator

- The server serves `apps/web/dist`; build with `npm run build -w apps/web` first. Same origin means `/ws` and
  `/v1/*` need no proxy.

## Round 8: version history endpoints (names agreed with the integrator)
The Versions screen (`#/versions`) uses these; a 404/405 on the list makes it fall back to the stored file or, with
`?mock=1`, to a labelled sample.
- `GET /v1/versions/hero_arena` returns `{ versions: VersionRecord[], currentHash }` (records as in the round 8 interface).
- `GET /v1/versions/hero_arena/:hash` returns the record plus its diff against the parent: `{ record, diff }` (or the
  record at the top level), `diff` being `[{ path, label?, old, new }]` or `{ changes: [...] }`. The card shows this diff.
- `POST /v1/versions/hero_arena/:hash/approve` ships a candidate (`approved: true`). The web reads the list again after.
- `POST /v1/data/hero_arena/select { dataHash }` makes a kept version current (the revert); the list is read again after.
- `POST /v1/playtest/auto { gameId, fromHash?, rounds: 1-3, requireApproval }` runs the rounds (`requireApproval` is the screen's "Ask me before each version" toggle, on by default); `playtest.progress`
  carries `round` (and optionally `rounds`) next to `phase`, which the button shows. The list is read again after. With
  `requireApproval: false` new records carry `approved: false`, shown as "candidate versions — not shipped".
Already working: `game.select { gameId, dataHash }` ("Play this version" opens `#/lobby/hero_arena?hash=<dataHash>`) and
`POST /v1/playtest/run { gameId, pairs, dataHash }` ("Run bots on this version").
Recorded mode reads `services/room/data/versions/hero_arena.json` (an array of records) if it exists; it does not today.
