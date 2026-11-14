# apps/web report

Status: all five requested items are built; `npm run build -w apps/web` passes. The real server did not exist in the repo when this was written, so **nothing here has been run against it**. Everything real-server related is written against the assumptions below.

## What to try by hand
- With the server: open `/` on the laptop, pick Hero Arena or Hero Cards, scan the QR (use the laptop's LAN address, not `localhost`), join from a phone, press Start match. Dashboard: `/#/dashboard` -> "Run 1,000 bot matches".
- Without the server: add `?mock=1` (`/?mock=1#/`). Open a lobby in one tab and `#/join` in another; the tabs talk over BroadcastChannel. Hero Cards in mock mode has a stand-in engine; an unheld seat plays itself.
- The Broken / Patched toggle (lobby and dashboard top bars) is global for the tab.

## Assumptions the server must meet (please check)

> Superseded: these were written before the room server existed. Items 1-3 turned out wrong; see "Live server check" at the end for what the real server does.
1. **WebSocket:** `ws(s)://<same host>/ws`, envelopes as in contract v0.1. The display sends `room.create {gameId, seats}` on every open, then `game.select {gameId, dataVersion}` and `match.reset` from the lobby, `match.start {gameId}`. Controllers send `room.join {joinCode,name,hero}` and `input.submit` (arena: `move`, `melee`, `projectile`, `guard`; cards: `play {handIndex, slot?}`, `end_turn`). Cards inputs carry `turnId` = the observation's `turnId`.
2. **Not in the addendum, added by the UI:** `room.status.payload.gameId` (optional; falls back to `match.started.config.gameId`, then `hero_arena`) so the phone knows which controller to show; `game.select.dataVersion` (`"broken"|"patched"`); `room.create` from the display. If the server ignores them nothing breaks, but cards phones will show the arena pad until `match.started` arrives.
3. **POST `/v1/playtest/run`**, body `{gameId:"hero_arena", matches:1000}`. Reply (see `src/lib/api.ts`, `normalizeRun`):
   `{ baseline: Report, patched?: Report, proposal?: { patch: PatchProposal, origin: "gemini"|"fallback"|"manual", validation: { ok: boolean, errors?: string[] } }, verdict?: { verdict: "accepted"|"rejected"|"inconclusive", reasons: string[] } }`. Aliases accepted: `before`/`report`, `after`, top-level `patch`/`origin`/`validation`, `verdict` as a bare string. A reply without a report shows an error panel, never a crash. If `patched` is missing, the Broken/Patched toggle has nothing to switch to.
4. Report optional fields from the addendum are used: `elapsedMs`, `recorded`, `createdAt` (unused), `humanMatches`. The `recorded · N matches · T s` badge appears only when `recorded === true`; otherwise a plain "N matches · T s".
5. Wilson intervals and the outlier rule (interval fully outside 45-55%, n >= 30) are recomputed in the browser from `wins/games`; the report's `ci95` and `outlier` fields are ignored.

## Known gaps
- **Not verified at a true 1920x1080.** The browser window reports a 1512x801 viewport. The dashboard is now a fixed 1920x1080 stage scaled to the window (see Round 3), so it is checked at that layout; other laptop screens flow. Phone screens were checked inside a 390x844 iframe. Light theme was not checked on screen.
- The dashboard canvas still plays the sample Observation loop; the matches table in real mode shows only bot and human totals. There is no per-match list API.
- `lib/cards.ts` mirrors card ids, costs and powers from `packages/games/cards/data.js` for labels and art only. Card art uses the viewer's hero (`{hero}_{attack|guard|signature}.png`); the cards observation has no hero field.
- Cards HP shows `/20` from the rules because the cards observation carries no `maxHp` yet (arena uses `maxHp`, else 100).
- Real transport: backoff reconnect only; a reconnecting controller re-sends `room.join` and relies on the server giving the seat back. No server-side `reconnect` message is used.
- No automated UI tests were added.
- Hero Cards on the laptop is a Phaser scene (kit PNGs stay inside Phaser, per docs/ui-tone.md); the phone hand is code-drawn with card art as images.

---

# Round 3 (high-end quality pass)

All six blocks are built and committed in order H, N, G, I, K, J. `npm run build -w apps/web` passes. Still **no real server to test against**: everything below was exercised with `?mock=1`, plus real mode with no server to see the unreachable and fallback paths.

## What was built
- **H, side-by-side replay:** the dashboard shows two Phaser arenas, broken data left and patched data right, one frame clock and one seed (12345). Above them a diff card: field, old -> new (struck-through old value), the model's rationale, an origin badge (gemini / fallback / manual) and the validation result. Replay frames come from `lib/replayGen.ts` (integer math, seeded xorshift32): the seed fixes positions, the version fixes damage. It is labelled "Illustrative replay (mock), not a recorded match" because the API has no replay stream yet.
- **N, Nightcrow and 15 matchups:** Nightcrow is selectable everywhere; its projectile uses the `crow_dive` effect (kind -> effect sprite, falling back to `spirit_arrow`). The dashboard lists all 15 matchups (5 heroes, mirror matches included) in one dense chart, outliers first, then by distance from 50%.
- **G, live batch:** while bots play, a counter ticks up, a progress bar fills and every matchup's bar and Wilson interval narrow live; an outlier lights up (warning fill, outlier badge, left bar) the moment its interval leaves 45-55%. A grid of ten mini-arenas with moving dots is texture only. Real mode listens on WebSocket topic `playtest.progress` (observer connection sends `subscribe {topic}`); mock mode drives the same UI from `lib/progress.ts`. When the run finishes the chart switches to the stored report's own numbers; the mock generator is monotonic and its last tick is identical to the report (checked with a small script).
- **I, game feel (all cosmetic):** hit flash, shake by weight tier (tier from damage relative to max HP, since the observation carries no tier), floating damage numbers, projectile trails with the effect sprites, KO slow motion (scene clock x0.3 for about a second) with a falling KO pose, idle bob, squash on hit and stretch on movement, eased HP bars. Phone: `navigator.vibrate` on hit and KO, following the player's own HP. Sound: WebAudio blips, no audio files, a "Sound on/off" toggle on the arena and the phone (persisted); audio starts after the first tap or key press. Under `prefers-reduced-motion`: no shake, bob, squash, trails, slow motion, float or autoplay; the hit flash and numbers stay.
- **K, states:** launcher art skeleton and a "couldn't load the art" notice; lobby skeleton for QR, code and seats while connecting; arena "connecting / waiting for the match" overlays; a "Server unreachable" panel (lobby, arena, phone join) with Try again and "Use sample data" (`?mock=1`); an error boundary around the app; Broken/Patched toggle disabled when a run has no patched data. **Recorded mode:** if the live run fails, the dashboard plays the stored run (`services/runner/recorded-*.json`, read-only, loaded lazily) through the same live view and says so; it is labelled `recorded · 200 matches · 3 s`. In that stored run Bari wins 200 of 200 (computed from the files; the first job puts Bari in p1, the swapped job in p2). Real WebSocket retries stop after five attempts.
- **J, human row:** after a phone match, "See the report" opens the dashboard with the human row directly above the bot row and a "you just played this" highlight (accent tint, left bar, badge). The finished match is kept in `sessionStorage`.

## UI fixes from reviewing screens (standing instruction)
1. Arena HUD: name and HP text sat directly on the busy floor art. They now have a dark plate; heroes drawn 20% larger (scale 0.3 -> 0.36); the "sample replay / tick" overlay got a dark pill.
2. Replay canvases were double-shrunk inside the scaled dashboard stage (Phaser measures a scaled parent). Phaser now runs in `Scale.NONE` and CSS stretches the canvas.
3. Launcher tiles wrapped to two rows below ~1776px; now three columns down to 1000px.
4. Chart rows had different label widths per row, so bars did not line up; label column is fixed.
5. Dashboard did not fit one screen with 15 matchups: now a fixed 1920x1080 stage scaled to the window (as in docs/ui-tone.md section 07). Below 1100px wide it flows normally.
6. Lobby: content centred vertically, bigger player chips (80px) with a hero-colour edge, larger start button.
7. Phone: stick ring and button outlines were about 1.8:1 against the pad (needs 3:1); now `--text-3`. The stick ring shrinks to 164px on narrow phones so it no longer touches Guard. Header gets a hero-colour underline; "You're Bari." is now 20px bold; button labels use text-1.
8. Replay heroes are fixed to the baseline's target matchup so they do not change when the toggle flips.

## Assumptions added this round
- `PlaytestRun.proposal.changes?: [{path, label?, old?, new}]` for the diff card's old values (without it the old value shows as an em dash). Mock shows `100 -> 72`, marked "sample".
- WebSocket topic `playtest.progress` payload: `{done, total, rows?: [{dimension, wins, games}]}`, subscribed with `subscribe {topic}`.
- 15 matchups come from the report's rows; nothing in the UI invents them in real mode. The mock report is hand-picked sample data (1,000 games, 66-67 per matchup).

## Known gaps
- Console: in real mode with no server the browser itself logs failed WebSocket and 404 requests; the app adds no errors of its own. In mock mode the console was clean in the screens I opened.
- The 15-row dashboard was checked at the scaled 1920x1080 layout only; the phone controller and cards hand at a 390x844 iframe. The Hero Cards table was re-checked after the Phaser scale-mode change and renders correctly; the cards phone hand was not re-opened after the contrast pass.
- Replays are illustrative until the engine publishes accepted frame streams.

## Polish 23:00

Checks run: `npm test` (all node:test suites in the repo): **46 of 46 pass**, 45 s. `npm run build -w apps/web`: passes. No test was changed, skipped or deleted. The web app has no tests of its own; I did not add any in a polish pass.

**Changed**
- Readability: no line over 120 characters in `apps/web/src` (checked with a script; the CSS file is excluded). The 340-line `Dashboard.tsx` was split into `lib/dashboardData.ts` (formatting, theme, stored run, sorting, headline), `lib/useRunner.ts` (run, live progress, stored-run fallback), `components/ReportPanel.tsx` and `components/RunTable.tsx`; the screen itself now only composes them. Small helpers replaced several nested ternaries (`winnerLabel`, `rowClass`, `statusLine`, `unitLabel`, `myArenaEntity`).
- Dead code removed: three unused fixture exports (and the `report_patched.json` import), `isMuted`.
- Console noise: none in the app. The only `console` call is a warning in the error boundary when a screen crashes.
- Edge cases and bad input:
  - Observation payloads are shape-checked (`isArenaPayload` and `isCardsPayload` now require the arrays); malformed `room.status`, `state.view` and `match.ended` messages are ignored instead of replacing good state.
  - `/v1/playtest/run` replies: rows with impossible counts (wins above games, NaN, negatives) are dropped; a proposal missing `replacements` or `rationale` gets safe defaults; a report with no matchups shows an "empty report" panel.
  - A stored run in `sessionStorage` is ignored unless it still has report rows.
  - Match duration `NaN` shows an em dash.
  - Already handled earlier: server unreachable, dropped connection, malformed or oversized WebSocket frames, live run failing (stored-run fallback), missing art manifest.

**Performance** (production build via `vite preview`, Chrome on the dev laptop, display refresh about 120 Hz, devicePixelRatio 2, viewport 1512x857; frames counted with `requestAnimationFrame`)
| Screen | fps | worst frame |
|---|---|---|
| Dashboard idle: two Phaser canvases replaying | 111 | 34 ms |
| Dashboard during the live batch (50 progress ticks, chart redraws, mini-arenas) | 99 | 42 ms |
| Arena during a mock match (hit flashes, trails, shake) | 118 | 24 ms |
- JS bundle: 1.83 MB (453 KB gzip), almost all Phaser. The stored run (183 KB) is a separate lazy chunk and loads only when a live run fails.
- Matches per second: the web app does not run matches. The runner's own recorded sample (`services/runner/recorded-metrics.json`) reports 200 matches in 3.4 s, about 58 matches/s with two workers, including worker startup; that is the runner's measurement, not mine.
- Not measured: a low-end laptop or a phone's frame rate (the phone screens are plain DOM plus one small stick), and memory over a long session.

**Still blocked / open**
- No real server in the repo, so nothing in the web app has been run against `/ws` or `/v1/playtest/run`; the assumptions listed under Round 3 still need a check against the real server.
- Not verified at a true 1920x1080 window or on a physical phone (touch, vibration, audio), and the light theme has not been looked at on screen.
- The line-length rule was not applied to `styles.css` (one long selector list).

---

## Live server check

Checked against `services/room` on the `engine` branch (06860c2), started locally from a scratch worktree on
127.0.0.1 and driven both by node scripts (protocol level) and by the built web app in Chrome. Mock mode (`?mock=1`)
was changed to emit the same shapes.

### Message and field check
| Item | Server (real) | Web before | Now |
|---|---|---|---|
| Display connection | `/ws?role=display&gameId=` creates a room, or `POST /v1/rooms` then `/ws?roomId&hostToken` | plain `/ws` + `room.create {gameId, seats}` (extra field rejected, closed schemas) | creates the room with `POST /v1/rooms`, keeps `roomId` + `hostToken` in `sessionStorage`, re-attaches after reload or drop (same join code); falls back to a new room if the host token is refused |
| Envelope | server assigns `sessionId`; non-join messages must carry the room's `roomId` and current `epoch` (`AUTH_EXPIRED` / `STALE_TURN`) | own random `sessionId`, epoch fixed at 1 | uses the server's `sessionId`, `roomId` and the latest `epoch` it saw |
| `game.select` | `{gameId, dataHash?}` closed | sent `dataVersion` | sent only when the room's game differs, `{gameId}` only |
| `subscribe` | not a message; `playtest.progress` goes to every connected socket | sent `subscribe {topic}` | observer connection sends nothing |
| Start | needs exactly 2 connected seats | enabled with 1 | enabled with 2; copy "Two players start a match"; 2 slots |
| `room.join` | `{joinCode, name, hero}`; code 4 chars | max 6 chars | 4 chars |
| Reconnect | `reconnect {joinCode, seatToken, lastAck?}`; `lastAck >= 0`; 10 s; token rotates | re-sent `room.join` | `seatToken` from `room.status` stored in `sessionStorage` with a timestamp; after a reload or a socket drop within 10 s the phone sends `reconnect` and keeps its seat; refused tokens are cleared; `lastAck` omitted when nothing was acknowledged (-1 was rejected) |
| `state.view` | `{observation, tick, turnId, epoch, viewHash, events}` | read `observation` only | also reads `events` |
| Events | `combat.hit {source,target,amount,guarded,ignoresGuard,x,y}`, `combat.guard {playerId,phase:activate\|block,x,y}`, `combat.ko {playerId,source,x,y}`, `projectile.spawn {id,owner,kind,x,y,vx,vy,life,...}`, `projectile.expire {id,owner,x,y,reason}`, `action.used {playerId,actionId}` | HP diffs only | hit numbers (real amounts, blue when guarded), guard effect, KO, shot sounds, melee swing (Nightcrow's uses `crow_dive`); HP diffs remain as a fallback when no `events` field is present |
| Entities | `hero, x, y, hp, maxHp, facing, ...` (`maxHp` is sent; e.g. 540) | default 100 | uses `maxHp` |
| Projectile `kind` | move id: `spirit_arrow`, `projectile`, `crow_swarm` | assumed effect names | effect sprite by kind, else the owner's signature effect (`crow_swarm` -> `crow_dive`) |
| Actions | `actions.available`: `melee, projectile, guard, move`; one move and one attack per tick, increasing `seq` | same | unchanged; matches |
| `input.ack` | `{seq, status, acceptedTick}`, envelope `seq` = input seq | same | unchanged |
| Cards | `play {handIndex, slot?}`, `end_turn {}`, observation `{activePlayer, round, turnId, entities, peek, hand, outcome}`, entity has `deckId`, no `maxHp`; new cards `mechanical_crows` and `forethought` (kind `peek`); hero `nightcrow` picks the crow deck | missing the new cards | card names/effects added; unknown kinds fall back safely |
| `playtest.progress` | `{runId, gameId, dataHash, matchesDone, totalMatches, elapsedMs, matchups: [{matchup, heroes, wins:{hero:n}, games, draws, invalidMatches}]}` | `{done, total, rows}` | reads the real fields; win rate of the first-named hero; mirror rows hidden (see CHANGE_REQUEST 4) |
| `POST /v1/playtest/run` | body `{gameId, pairs}` (1-1000 pairs); reply `{resultsPath, elapsedMs, matchCount, dataHash, recorded}`; `GET resultsPath` = MatchResult[] | body `{gameId, matches}`; expected `{baseline, patched, proposal, verdict}` | sends `pairs = matches / 2`, fetches the results, builds the report in the browser (`lib/reportFromResults.ts`: grouping by `config.options.assignments`, invalid matches counted apart); no proposal, patched report or verdict exists on the server (CHANGE_REQUEST 2) |
| `GET /v1/replay/:matchId` | `{matchId, seed, config, frames, finalStateHash}`, frames are inputs | not used | used for the seed shown under the compare view; frames cannot be rendered in the browser (CHANGE_REQUEST 1) |

Measured on the real server: 1,000 bot matches (500 pairs, Bari vs Real Armor) in 29-30 s; the first 40-match run took 1.2 s. Progress arrived about every 100 ms. Reconnecting a phone after a reload mid-match restored its seat and view and rotated the token; a reconnect after 11 s was refused with `AUTH_EXPIRED`, as documented.

### Live vs mock, per screen
- **Launcher:** same in both; static page, no server call (the "Mock server" status label only appears with `?mock=1`).
- **Lobby:** live checked: real room and join code, QR, two phones joined, "Live server" status, Start only with 2 seats, host room kept across a reload; mock now also shows 2 slots.
- **Phone controller:** live checked: join, hero picker with all five heroes, move/attack inputs acknowledged, HP from `maxHp`, reload within 10 s resumed the seat; touch, vibration and gamepad not tried on real devices.
- **Arena:** live checked: real match drawn from live observations with the pulsing `live` badge, Nightcrow vs Bari and Real Armor sprites; event handling follows the real payloads (verified from a captured stream), but floating damage numbers and effects were not watched on screen against the live server.
- **Hero Cards:** protocol checked with a script (two seats, start, hand of 5, `play` accepted, `card.*` events); the table and phone hand UI were not opened against the live server.
- **Dashboard:** live checked: run button, live progress and counter, final report with `recorded · 1,000 matches · 30 s`, the human row (empty), stored-replay seed under the compare view. Mock-only: diff card values, patched data, verdict, 15 matchups (the live run has one matchup); the side-by-side frames are illustrative in both modes.

### Fixes made in this pass (one commit each)
protocol alignment (host room, session ids, epochs, closed payloads, two-player start, reconnect), `state.view` events,
real playtest API and progress, replaying the latest room messages to late subscribers (lobby -> arena mount),
`live` badge, `lastAck` and 4-character code fixes, stored replay seed, peek and crow-deck cards.

### Not verified
No physical phone, no second computer on the LAN, no `RUN_SOCKET_TESTS` run of the engine's own tests, no test of the
reconnect window under a real network drop (a page reload was used). The server was started with `HOST=127.0.0.1`.

## Polish 00:10

Checked again after the live-server pass: `npm test` 46 of 46 pass (43 s), `npm run build -w apps/web` passes, `tsc` is clean, no line over 120 characters in `apps/web/src`, and the only `console` call is the error boundary's warning. No test was changed, skipped or deleted. Performance numbers from "Polish 23:00" still stand; nothing that affects rendering changed except the arena now handles `events`, which added no measurable cost in a 118 fps arena run earlier (not re-measured).

**Changed:** removed one unused export (`getDemoVersion`, left over when the lobby stopped sending the data version).

**Still blocked / open** (unchanged, see "Live server check" and `CHANGE_REQUEST.md`): replay views and a patch proposal/verdict API need the engine; the Hero Cards screens and floating damage numbers were not watched against the live server; no physical phone or LAN test.

---

# Round 6: the live dashboard

Built against the shared interface in the task (`POST /v1/playtest/full`). Neither that endpoint nor `/v1/replay/:id/views`
nor bot start exists in the repo yet (checked `main` and the engine and analysis branches at 6745e53), so none of this was
run against a real server; it was checked with `?mock=1` (which now follows the same shapes) and with a pure-function test
of the response mapping.

## Step 1: Run calls /v1/playtest/full
- The button (now "Let the bots play", since the run size is the server's choice) calls `POST /v1/playtest/full
  {gameId: "hero_arena", roster: true}`. A 404/405 falls back to the older pairs run, so a server without the endpoint
  still works.
- `lib/fullRun.ts` maps the response to the page: `baseline`, `proposal` (+ `changes`), the top-level `validation`,
  `patched` (with `patchedDataHash` and `holdoutSeedSetId`), `verdict`, `humanMatches`, `elapsedMs`, `runId`. Bad rows
  (wins above games, NaN) are dropped; missing counters get neutral defaults; a bare Report is accepted as a
  baseline-only run. A script checked this on a response built from the interface text.
- Origin badges: `gemini`, `grok`, `fallback`, `manual` as is; `fake` is shown as "offline sample" with a tooltip saying
  no model was called.

## Step 2: live progress and phases
- `playtest.progress` is read as the room server sends it (`matchesDone`, `totalMatches`, `matchups[].wins/games`) plus the
  new `phase` (`baseline` | `holdout`). The report panel and the live panel name the running phase ("Baseline",
  "Holdout on the patched data"); the counter shows "…" until the first message gives a total.
- Win rate is the first-named hero's. Mirror rows (`bari vs bari`) are hidden unless the row carries `seatWins`, in which
  case `seatWins` is the win count. The same rule applies to the final report (`lib/groups.ts: botRows`) and to the
  before/after comparison. `?mock=1` now plays a baseline phase and then a holdout phase, with `seatWins` on mirror rows.
- Checked with a script: a progress message with a normal row, a mirror row without `seatWins`, a mirror row with it and a
  human row gives exactly the normal row and the seat-based mirror row.

## Step 3: human rows
- Rows named `human: a vs b` are a separate group ("Human matches") under the bot chart. They are never parsed as heroes
  (no portraits, `a` and `b` shown as text, so a player's name can never become a hero id or markup), never count for the
  headline, the target matchup or the replay heroes, and never raise an outlier alarm. Small samples show "Too few games
  yet". They are left out of the live bars.
- `?mock=1` includes one such row so the group can be seen.

## Step 4: recorded mode reads the stored roster run
- `lib/recorded.ts` looks for stored runs with a glob over `services/runner/recorded-*.json` (read-only; a file that is not
  there yet is simply absent, the build does not break). Order: 1) `recorded-roster-report.json`, read as a finished
  report or a whole `/full` response (real intervals come from its own counts, the chart recomputes Wilson from
  wins/games); 2) `recorded-roster-match-results.json` + `recorded-roster-metrics.json`, which exist today: the 15-matchup
  roster run (300 matches, 4 s) is turned into a report in the browser; 3) the older Bari vs Real Armor run.
- `recorded-roster-report.json` does **not** exist yet, so source 1 was only exercised through the mapping test, not from
  the file. Source 2 was run in the browser (live run failed with the dev server's 404, the stored run played through the
  live view and the page said so).
- Mirror matchups from match results now carry `seatWins` (games won by the first seat), so they show instead of being
  dropped.
- Found while checking: with 20 games per matchup every row is "too few games", and the headline used to show a 100%
  rate for the first row. A row with fewer than 30 games can no longer be the target; the headline then reads "Too few
  games per matchup yet" and the big number is just the game count.

## Step 5: side-by-side replay sources
Order, best first (`lib/replaySource.ts`):
1. **Real views:** `GET /v1/replay/:matchId/views?dataHash=<hash>` for the baseline hash and the patched hash. Accepted shape
   (an assumption, the endpoint does not exist yet): an array of Observations, or `{views: [...]}`, where an item is an
   Observation or `{observation, events?}`. Anything else counts as "not there". Both sides must load.
2. **Analysis HP timeline:** an optional `replay: {matchId, heroes, maxHp, timeline: {broken, patched}}` in the `/full`
   response (samples `{tick, hp: {p1, p2}}` on change, as `packages/analysis/src/replay.js` produces). HP follows the
   samples; positions were not recorded, so heroes stand still and the footnote says so.
3. **Illustrative replay**, the generated frames, labelled "Illustrative replay, not a recorded match". Invented frames never
   appear without that label. The old stored-seed note stays when only a stored replay's seed is known.
- Checked: parser and frame builder with a script (arrays, wrapped views, bad input, timeline lookup by tick); the timeline
  path in the browser with `?mock=1&replay=timeline` (a new mock-only switch); the illustrative path as before. The views
  path was **not** run against a real endpoint.
- The `/full` response in the task has no `replay` field; if the analysis puts the timeline somewhere else, only
  `replayFrom` in `lib/fullRun.ts` needs to change.

## Step 6: "Play vs bot" in the lobby
- A secondary button next to "Start match" sends `match.start {gameId, bot: true}`; it is enabled with at least one player
  connected, "Start match" still needs two. The lobby now waits for the server's `playing` status before going to the big
  screen, and if the server answers with an error it stays on the lobby and says why ("The server can't start yet..." /
  "This server can't start a match against a bot yet.").
- Checked in the mock (starts with one player) and against the real room server on `main` (6745e53), which does not know
  `bot` yet: the button was refused and the lobby showed the message. Bot start itself was **not** run against a real
  server because none supports it yet.
- Bug found and fixed while doing this: the lobby's "start from a clean lobby" reset ran on every phase change, so a match
  started from the lobby would have been reset by its own status message. It now runs once per visit.

## Checks for round 6
- `npm run build -w apps/web` passes; no line over 120 characters; `tsc` clean.
- Real server (`main` at 6745e53, run locally): the dashboard falls back from the missing `/v1/playtest/full` to the pairs
  run and showed `recorded · 1,000 matches · 28 s` with live progress; the lobby, join and refusal path worked.
  Not exercised against a real `/full`, `/views` or bot start (they do not exist in the repo yet).
- 1920x1080: the dashboard stage and lobby were looked at with the 15-matchup live run, the human group and the
  side-by-side replay. 390x844 (iframe): the lobby and dashboard looked broken (top bar overflow, cut-off QR, squeezed diff
  card and replays); fixed with a phone layout (stacked cards, wrapped top bar, one-column chart rows, scrollable
  matches table) and re-checked. The phone controller was not changed this round.
- Mock-only switches: `?mock=1&replay=timeline` shows the HP-timeline replay path.

## Polish 01:10

Checked: `npm test` 159 tests, 153 pass, 6 skipped, 0 fail (48 s; the skips are other folders' opt-in socket and end-to-end tests, none are web tests and none were changed). `npm run build -w apps/web` passes, `tsc` is clean, no line over 120 characters in `apps/web/src`, no unused exports, and the only `console` call is the error boundary's warning.

**Changed:** the lobby could leave "Start match" and "Play vs bot" disabled forever if the server never answered a start request; it now gives up after 6 s and says "The server didn't answer. Try again."

**Performance** (production build, `?mock=1`, display about 120 Hz, devicePixelRatio 2, viewport 1512x857, frames counted with `requestAnimationFrame`): dashboard idle with two Phaser canvases 102 fps (worst frame 74 ms); dashboard during the two-phase live batch with 15 matchup bars, human group and mini-arenas 88 fps (worst frame 74 ms). Earlier numbers were 111 and 99 fps with a worst frame of 34-42 ms; the dashboard now draws more rows and a second phase, and one worst-frame spike is higher, but it stays smooth. Not re-measured: arena (118 fps earlier), phones, long sessions. The matches/s figure belongs to the runner (roster sample: 300 matches in 4.3 s, about 69 matches/s), not to the web app.

**Still blocked / open:** `/v1/playtest/full`, `/v1/replay/:id/views`, `recorded-roster-report.json` and bot start do not exist in the repo yet, so those paths were only checked with the mock and with pure-function tests; no physical phone test.

## Polish 03:14

Nothing to change. `npm test` 153 pass, 6 skipped (other folders' opt-in tests), 0 fail; `npm run build -w apps/web` passes; no line over 120 characters. Performance numbers and blocked items are unchanged from Polish 01:10.

## Polish 04:14

Nothing to change since Polish 03:14. Tests 153 pass, 6 skipped, 0 fail; build passes; no line over 120 characters. Blocked items unchanged.

## Round 7

**1. Origin labels and error states.** `fake` already showed as "offline sample" (never "manual") and `grok` is a known origin; unknown origins still fall back to "manual". Failed requests now keep the server's error `code` and `message` (`ApiError.code`; text like "RATE_LIMITED: Too many requests. Wait before retrying."). The dashboard shows that text in the notice (when the stored run is shown instead) and in the error box. The old "Check that the server is running" hint now appears only when the server could not be reached.

**2. Long roster run.** `fetch` has no timeout of its own and the app sets none, so `POST /v1/playtest/full` can take a minute or more. While it runs, the live panel and the report header show the phase and a seconds counter that ticks every second, even between progress messages; before the first message the bar sweeps back and forth (a still, dimmed bar with reduced motion). The bars still follow `playtest.progress` from `/ws`.

**Checks.** `npm run build -w apps/web` passes; `npm test` 173 pass, 0 fail, 6 skipped. In the built app: mock run shows "Baseline · 550 of 1,000 matches · 2 s" and the counter in the report; against a local stub that answered 429 `RATE_LIMITED`, the dashboard showed "RATE_LIMITED: Too many requests. Wait before retrying. Showing the stored run instead." Phone width (390x844, in a frame) renders the live panel with the timer without overflow. Desktop was checked in a 1512x825 window, not 1920x1080.

**Not verified:** the minute-long wait against the real `/v1/playtest/full` (only the mock and the stub), and the Bari vs Real Armor result, which is the engine's side. No recorded or benchmark file was regenerated.

## Round 7 presenter

**Route `#/present`** (`screens/Present.tsx`, `lib/presenter.ts`; the only edits to existing files are the route in `App.tsx` and new CSS at the end of `styles.css`). Five scenes: the match, bots play, the patch, same seed in both versions, verdict. It starts the same run as the dashboard button (`useRunner`: `POST /v1/playtest/full` on a real server, the mock with `?mock=1`, the stored run if the server fails) as soon as the page opens, so the minute-long request runs while the first scene shows.
- *The match* shows the human match you just played (from the saved result) or, if there is none, a title card with no numbers.
- *Bots* shows the live bars from `playtest.progress` and the elapsed seconds; it waits (progress bar) until the run has finished, however long that takes.
- *Patch*, *replay* and *verdict* render only what the run contains: the proposal, the replay source (views, HP timeline or the labelled illustration) and `run.verdict` with its own reasons. Nothing is written in advance; with no verdict or patch the scene says so.
- A badge in the top bar names the data source the whole time: `live run`, `recorded · N matches · T` (whenever the stored run is used) or `sample data` (`?mock=1`).

**Keys and timing.** Space/Right next, Left back, P pause, R restart (re-runs the batch). Minimum times: 5 s, 8 s, 8 s, 12 s; the last scene stays. A scene advances on its own when its time is up and, for the bots scene, the data is in. Next/back always work, and later scenes show a waiting bar if the run is not done.

**`?auto=1`** (in the query string or after the hash) runs the same flow to the end at those intervals, hides the key hints and the cursor.

**Checks.** `npm run build -w apps/web` passes; `npm test` still has 0 failures. **1920x1080 for real:** headless Chrome (`--headless=new --window-size=1920,1080 --virtual-time-budget=...`) works here, so I took screenshots of the mock run (`?mock=1&auto=1`) at 3, 9, 15, 25 and 45 s (match, bots, patch, replay, verdict) and of the recorded fallback (no server) at the same times. One fix came out of it: the large verdict word overlapped its reason line. The recorded run (`recorded-roster-report.json`) has no proposal or patched run, so patch, replay and verdict scenes say there is none rather than showing anything; with the real server they fill in. The `recorded · 300 matches · 6 s` badge was on screen throughout. **Phone width:** headless Chrome will not go below about 500 px, so I used a 390x844 frame; it showed the first scene without overflow; the later scenes were not checked at 390 (the stage is built for the 1920x1080 projector).

**Not verified:** the real `/v1/playtest/full` flow and its timing (left for the 10:00 demo), key presses (the handler is plain `keydown`, tested only by reading), and the human-match scene with a real just-played result.

## Round 8 feel

**A. Arena smoothness (snapshot interpolation).** `lib/snapshotBuffer.ts` stores every `state.view` by tick and draws about 4 ticks (about 67 ms) behind the newest one on a local 60 Hz clock, interpolating hero and projectile positions linearly between the two snapshots around the render tick. When the buffer runs dry it extrapolates from the last two snapshots for at most 2 ticks, then holds. It uses elapsed time, not frames, so 60 and 144 Hz screens move alike. The clock follows the least-delayed packet quickly and drifts back slowly, so bunched packets do not move it; a packet whose tick is already behind the render tick is counted as late. The render delay grows when snapshots are further apart (the mock sends one per 6 ticks, so it uses 7). HP, facing, which projectiles exist and events (hit, guard, KO, spawn) are not blended: the scene applies them when the render tick reaches the snapshot that carries them, so events fire at their tick (4 ticks later than arrival). `useRoom` now also gives every packet to listeners as it arrives (`views`), so a burst is not collapsed into one React render. The side-by-side replay keeps its own frame clock and the old easing (it has no live packets). `?debug=1` adds a line at the bottom left of the arena: buffer depth, render delay, late packets, guessed frames.
Simulated check (node, `lib/snapshotBuffer.ts` bundled with esbuild, 300 ticks of constant motion, 25% of packets 0-80 ms late and bunched): per-frame step at 60 fps had a standard deviation of 0.336 units with the old easing and 0.130 with interpolation (mean 0.98 either way); worst step 1.74 vs 1.04; 22 of about 290 frames used the 2-tick guess; at 144 fps the deviation is 0.059 around a mean of 0.41. This is a simulation of the network, not a Wi-Fi measurement. In the built app with `?mock=1&debug=1`, the arena draws, the overlay shows buffer 1, delay 7, late 0.

## Round 8 result card

**1. Live run request.** The dashboard Run now sends `POST /v1/playtest/full {gameId: "hero_arena", pairs: 100}` with no `roster`: Bari vs Real Armor only, 400 matches, which is over the 200-game verdict gate (the earlier roster run had about 100 games per matchup, so the verdict was always inconclusive, and its holdout phase restarted the table). The all-matchups table now comes from the recorded roster report, labelled recorded (step 3 below).

**2. Never reset.** When the `holdout` phase starts, the baseline counter and table stay as they were (frozen at the finished baseline); the holdout run gets its own bar and counter in the live panel and its own strip above the baseline table (the baseline's three most lopsided matchups, on the patched data). Checked with the mock run (two phases): the baseline kept "1,000 / 1,000" while the holdout counted 450, then 850, of 1,000. `foldProgress` in `lib/useRunner.ts` is the one place that decides this.

**3. Result card** (`components/ResultCard.tsx`, facts in `lib/resultCard.ts`). When a run ends, a card replaces the patch card at the top of the left column and stays until the next Run starts; the run is kept in `sessionStorage` (`saveRun`), so it is restored after a reload. It shows: (a) the outlier matchup, win rate, 95% CI and games (or "most lopsided matchup" when nothing is outside the normal band); (b) no evidence line: the report's only per-row extras are `uses` and `opportunities`, which count every action, so they are not evidence for a specific flaw and nothing else in the report names one; (c) the AI patch: field, old → new, rationale, origin badge (`offline sample` for `fake`) and validation; (d) the holdout win rate with CI and games for the same matchup, and the verdict badge with its first reason; (e) other findings from the stored roster report, labelled `recorded`: matchups whose CI lies outside 45-55% with at least 30 games. The recorded roster report has 20 games per matchup today, so (e) says "No matchup can be judged yet: at most 20 games per matchup, and an outlier needs 30" instead of naming Daewi. With the live run (no roster) the right panel shows the run's own matchup and, below it, the stored roster table under "All matchups · recorded".
Checked with the mock run at 1456x825 (the dashboard is scaled from 1920x1080: the left column now ends exactly at 1080 after the four-column card and a narrower replay). The 390 px layout uses one column; not looked at in a browser yet.

**4. Copy summary.** The button copies the same facts as plain text (`summaryText`): source, outlier, patch with validation, holdout, verdict, other findings. It uses the clipboard API with a hidden-textarea fallback and says "Copied" or "Couldn't copy". The text was checked with made-up inputs in node (format only; nothing from them is shown anywhere).

## Round 8 versions

**Versions screen** (`#/versions`, `screens/Versions.tsx`, `lib/versions.ts`; linked from the dashboard top bar). Left: the history, newest first, a branch indented one step per sibling (`layoutRows`). Each row: short hash, origin badge, current marker, the changed fields, the target matchup before → after and the verdict badge; a version with `approved: false` is labelled "candidate versions — not shipped". Right: the selected version in the round 7 Result card (its change list is the diff against its parent, named in the caption) and four buttons: Play this version (`#/lobby/hero_arena?hash=…`; the lobby now sends `game.select {gameId, dataHash}` and shows a "version" badge), Run bots on this version (`POST /v1/playtest/run` with `dataHash`; shows the target matchup's rate with CI), Continue auto-balance from here, Make current (the revert). Above the list: rounds selector 1-3, an approval toggle (default on; off shows the "not shipped" note) and Auto-balance (it starts from the current version).
**Data sources.** Live: `GET /v1/versions/hero_arena`; the history endpoint, auto-balance and make-current are not in the room server yet, so they are listed in `CHANGE_REQUEST.md` as assumed names. Recorded: `services/room/data/versions/hero_arena.json` if it exists (it does not, so no stored 3-round history is shown; the empty state says so). `?mock=1`: a labelled sample of three records (the base, the fixture patch with the fixture numbers, and a not-measured candidate); no new numbers were made up.
**Checks.** Against a throwaway stub server that implements the assumed endpoints (stub numbers only, deleted afterwards): the list loaded, Auto-balance with 3 rounds added three versions, approval off added three "candidate versions — not shipped" rows, Make current moved the current badge, Run bots showed the server's `RATE_LIMITED` code and message, Play opened the lobby route with the hash. 1920x1080 headless screenshot of the sample and 390x844 frames of the live-stub and sample views were looked at; a fix came out of the phone view (the rounds selector and Copy button were cut off). Not verified: the real endpoints, the lobby `game.select` with a hash against the real server (the schema allows it), and a branched history (the layout code handles siblings but no branch was on screen).

## Round 8 feel: B. Phone mini arena

The controller shows the same `ArenaScene` above the stick and buttons (about 35% of the height at most, 16:9, `components/ArenaCanvas` with `compact`, `smooth` and the packet feed from `useRoom`), so it uses A's snapshot interpolation with the phone's own `state.view`. One footer button, "Arena: on/off", toggles it (default on); the Hero Cards hand has no arena view and no button. While it shows, the text block above the stick is tighter so the controls stay on one 390x844 screen. Checked in the mock at 390x844 (a frame in a tab, joined to a lobby tab, "Play vs bot"): the arena drew and moved, the HP bar, stick, three buttons and footer fit without page scroll, and toggling off removed the canvas and back on restored it. Not checked: a real phone (touch, battery, Wi-Fi jitter) or the real server's packets; the small canvas stays silent, so only the big screen plays sounds.

## Round 8 versions: engine endpoint names
The Versions screen now uses the names the integrator gave: `GET /v1/versions/hero_arena` (`{versions, currentHash}`), `GET /v1/versions/hero_arena/:hash` (record plus diff against the parent; the card shows that diff), `POST /v1/versions/hero_arena/:hash/approve` (new "Approve" button on a candidate), `POST /v1/data/hero_arena/select {dataHash}` (Make current) and `POST /v1/playtest/auto {gameId, fromHash?, rounds, requireApproval}` (the button shows the `round`/`phase` of `playtest.progress`). After each action the list is read again. The screen's "Approval" toggle (on: an accepted version ships by itself) is sent as `requireApproval = !toggle`; if the engine means the toggle itself, flip that one line in `runAutoBalance`. Checked against a throwaway stub of these endpoints (deleted): list, server diff on the card, auto-balance with approval off giving "candidate versions — not shipped", Approve clearing the label, Make current. `CHANGE_REQUEST.md` lists the names; no real server yet.

## Round 8 versions: toggle wording and the evidence line
**Toggle.** The screen's toggle is now "Ask me before each version" (on by default) and is sent as `requireApproval` unchanged; this replaces the inverted mapping noted above. Rows the server marks `approved: false` are labelled "candidate versions — not shipped"; with the toggle off the screen also says so above the list, as asked. (One thing to check on the engine side: with the toggle off nothing asks, so whether such versions end up approved or candidates is the engine's call; the web only shows what each record says.)
**Evidence line** (Result card, under the outlier). Parsed from the run body's `evidence` (`{missing, rows: [{dimension, games, focal, other}]}`, sides with `hero`, `damageShare`, `actions[{actionId, opportunities, uses, useRate}]`) by `evidenceFrom` in `lib/fullRun.ts`, and written by `evidenceLine` in `lib/resultCard.ts` for the outlier's matchup: "Bari dealt 71% of the damage; spirit_arrow used on 64% of chances (Real Armor guard used on 40%)". It uses the focal side's highest-use-rate non-guard action and the other side's guard action; any part with a null number, or a field named in `missing`, is left out, and if nothing is left there is no line. The line is also in Copy summary. Checked in node with the shape from the integrator (the example line came out as written, null numbers and `missing` fields removed the parts); no real run body with `evidence` yet, so it was not seen on screen. Only the first outlier gets a line (the card has one outlier); the recorded roster report has no evidence.

## Round 8 feel: C. Procedural hit feel
`components/hitFeel.ts` (wired into `ArenaScene`), all cosmetic and driven by events, never state:
- **Hit-stop**: on `combat.hit` the world holds still for 3, 4 or 5 frames (50, 67, 83 ms at 60 Hz) by hit weight. Interpolated positions are not applied meanwhile (events and snapshots still arrive); afterwards sprites ease back to the true position over about 120 ms instead of jumping.
- **Knockback**: the hit hero is pushed away from the other one (11-21 px by weight) and settles with a 90 ms decay.
- **Attack lunge** (lean forward): when the snapshot buffer already holds an `action.used` attack up to 5 ticks ahead, the attacker leans and shifts about 12 px forward until the attack lands (hold at most 220 ms), then releases; without lookahead (replay views, mock) a short pulse at the event.
- **White hit flash**: the tint-fill now lasts 85-135 ms by weight (it stayed 80 ms before) so it spans the hit-stop.
- **Particles**: a burst from the hit point (6, 10 or 16 sparks by weight, white plus the hero's colour) from a generated dot texture; no new image files.
- **Poses**: `common/heroes/<id>/attack.png`, `hit.png`, `ko.png` are used when present, else `full_body.png`. A pose is picked up only if `assets/manifest.json` lists it (probing for missing files would fill the console with 404s); poses should have the same canvas size as `full_body.png` because the sprite keeps its origin and scale. Attack pose 260 ms, hit pose 200 ms, ko pose until revive.
- **Reduced motion**: with `prefers-reduced-motion` there is no hit-stop, knockback, lunge or particles; the flash (a colour change) and the poses stay.
Checked: a node run of `HitFeel` with a stub scene (tier 3 gives 5 stop frames, one burst, knockback 6.9 px on the first frame then decaying, catch-up rate 0.33 then 1, lunge +-11 px, release, and with reduced motion nothing but the pose); in the built mock arena (with temporary pose files listed in the ignored `dist` manifest, removed after) the three pose images loaded and there were no console errors. Not checked by eye: the feel itself in motion (hit-stop length, knockback size and particle look need a person playing), and real pose art.
Also: the `?debug=1` line moved to the bottom right and no longer counts held frames as guessed.

## Round 8 presenter: version history scene
**Last scene of `#/present`: "Version history"** (`scenesFor` in `lib/presenter.ts`, `HistoryScene` in `screens/Present.tsx`). It lists the versions read only, newest first, branches indented, with the same rows as the Versions screen (`components/VersionRow.tsx`, now shared) and a label for where the history comes from. Source order: the live list (`GET /v1/versions/hero_arena`, read again when the run finishes because a run can add a version), else the recorded history file, else (`?mock=1`) the labelled sample, else the scene is left out and the flow ends at the verdict as before. A history of only the base version also leaves the scene out. The verdict scene now stays 8 s when a history follows. The step bar counts the scenes it really has.
**Walk-through.** Headless Chrome at 1920x1080, `?auto=1`, scenes at 3, 9, 17, 27, 38 and 60 s: mock mode ends on the history (six steps), recorded mode (no server, so the stored run) ends on "This run has no verdict" (five steps; the stored 3,000-match roster run has no patch, and there is no stored version file). Nothing overflowed at 1920x1080. At 390x844 in a frame, stepping through all scenes with the arrow key: one fix, the screen-reader table of the win-rate chart (`table.sr-only`) was 502 px wide and made the page scroll sideways; it is now a 1 px block. The bots scene is taller than the phone screen (it scrolls down, not sideways); the other scenes fit. Not walked: a live server (it would add the live history), keys in a real browser window (the arrow key was sent as an event).

## Round 8 screenshots
Headless Chrome works in this shell, driven over its debugging port (a throwaway node script using the repo's `ws`; not committed), so the four README/Devpost shots are real 1920x1080 PNGs in `apps/web/screenshots/` (own folder; the integrator copies them to `docs/screens/`): `lobby-qr.png` (room code and QR, two players), `arena-fight.png` (arena mid-fight), `dashboard-result.png` (dashboard with the Result card after a run), `versions.png` (version history). They were taken from the production build in `?mock=1`, so each carries its own "Mock server" / "sample" / "sample data" labels: the numbers in them are the fixtures', not a measured run. No personal data (the lobby player is called Mira), but the lobby shot shows `localhost:4173` in the join address. Retake them from a live server run once one exists.
The presenter and its history scene use the mock sample only with `?mock=1` (checked in `loadHistory`): otherwise the order is live, then recorded, then the scene is skipped.

## Round 8 phone load time
**What changed.** `App.tsx` now loads every screen except the phone controller with `React.lazy` (Launcher, Lobby, Arena, Dashboard, Versions, Present, each its own chunk), and the controller loads the Phaser canvas (`ArenaCanvas`) lazily too, so the join form and the controls do not wait for Phaser. The main bundle went from 1,842 KB (454 KB gzip) to 270 KB (85 KB gzip). Chunks (gzip): Phaser with the arena scene 347 KB, Lobby 12 KB (with the QR code), Dashboard 4 KB, Versions 2 KB, Present 3 KB, Arena 4 KB, shared API/runner code 8 KB.
**Recorded files.** They were already dynamic imports, and the stored-run loader already prefers the small `recorded-roster-report.json` (2.5 KB, 0.8 KB gzip) and uses the 2.9 MB `recorded-roster-match-results` (173 KB gzip) only if that report is missing or unusable. Checked: a dashboard run with no server (recorded fallback) requests the roster report chunk and not the match-results chunk, and `#/play` requests none of them. No code in the web app needs the match results for a replay today (the side-by-side replay uses views, the analysis timeline or a labelled illustration), so there is nothing else to defer.
**#/play transfer, measured in headless Chrome with the cache off** (requests listed by the browser; JS and CSS gzipped with `gzip -9`, as a static host would send them; fonts and PNGs as stored): join form before 1,051 KB, after 682 KB (JS 454 KB → 85 KB). After a join the phone also loads the Phaser chunk (about 347 KB gzip) plus the arena floor and hero pictures for the mini arena, as before but now after the controls are up. What is left on the join form is mostly the five hero portraits: 516 KB of PNG (95-118 KB each, shown at 56 px). Resizing them to about 128 px thumbnails would save most of that; it needs new art files and a manifest entry from the asset owner, so it is not done here. The arena floor is a 2.7 MB PNG, also an asset question; the Noto Sans KR Korean fonts (about 550 KB each) load only when Korean text is on screen.
**Checks.** Mock flow after the change: lobby with a joined player, Play vs bot, arena, the phone controller with its lazy mini arena (one canvas), dashboard run, versions, all with no console errors. Not measured: a real Wi-Fi or tunnel link, and servers that compress (a host without gzip sends the raw sizes).

## Round 8 image weight
Approved by the asset owner (`apps/web/public/assets` is in the web folder); originals are kept.
- **Portrait thumbnails.** `common/heroes/<id>/portrait_128.png` (128x128, `/usr/bin/sips -Z 128`, 29-35 KB each against 95-118 KB), listed in `manifest.json` with role `portrait_thumb`. `HeroPortrait` uses the thumbnail whenever the portrait is drawn at 64 px or less (`THUMB_MAX_PX`; the phone header, the hero picker, the lobby chips, the mini rows) and the original above that (the 120 px duel in the presenter).
- **Arena floor.** `hero_arena/backgrounds/arena_floor.webp` (`/opt/homebrew/bin/cwebp -q 82 -resize 1152 648`; the scene draws the floor into a 1152x648 canvas, the small replay canvases at 768 wide, so no larger size is used) listed in the manifest with `fallback` pointing at the PNG, which stays. `preferWebp()` in `lib/assets.ts` picks the WebP when the manifest lists it and the browser can decode WebP, else the PNG; the launcher tile uses it too.
- **Sizes.** Arena floor: 2,784,531 bytes (PNG) to 78,114 bytes (WebP, 2.8%). `#/play` join form, gzip as in the last measurement (cache off, headless Chrome): 1,051 KB at the start of the day, 682 KB after the lazy screens, 323 KB now (JS 85 KB, thumbnails 157 KB instead of 516 KB, fonts 71 KB, CSS 9 KB, manifest 1 KB). The launcher still loads the hero-cards table and the rooftop art as PNG (not part of this task; they are also large).
- **Checked by eye** (headless screenshots, 1920x1080 arena from the production build and 390x844 join form at 2x): the WebP floor is indistinguishable from before in the arena, and the thumbnails are sharp in the 60 px circles of the join form. Not checked: Safari, or a browser without WebP (it takes the PNG path, which is unchanged code but was not run here).

## Round 8 image weight, part 2
**What was converted** (WebP with `/opt/homebrew/bin/cwebp -q 82 -alpha_q 90`, next to the PNG, listed in `manifest.json` with `fallback` pointing at the PNG; `preferWebp()` picks it when the browser can decode WebP): `hero_cards/backgrounds/table.webp` 1152x648 (2.03 MB to 57 KB; the table is drawn into a 1152x648 canvas), `sepia_tentacle_run/backgrounds/rooftop.webp` 960x540 (2.76 MB to 70 KB; only the launcher tile uses it), the 15 `hero_cards/cards/*.webp` at 288x216 (about 390 KB each to about 20 KB, 5.9 MB to 308 KB in all; drawn 140 px wide on the phone hand), the five `common/heroes/<id>/full_body.webp` at 384x384 (200-230 KB each to 28 KB, about 1 MB to 116 KB; the arena scales the sprite by `512 / texture width`, so heroes keep their on-screen size). Used in the launcher tiles, the Hero Cards table and phone hand, and the arena. The arena floor and portrait thumbnails are from the earlier step.
**Also found and fixed:** every screen with an arrow ("← Lobby", "→") or a "▲" downloaded the 530 KB Noto Sans KR Korean file, because Inter's Latin files lack those glyphs and the browser fell through to Noto. A `UI Symbols` font-face (local Arial, Helvetica, Segoe UI Symbol or DejaVu Sans, only for arrows, shapes and check marks) now sits first in the font stack, so Noto loads only when there is Korean text. Arrows now come from the device's own font (slightly thinner than before).
**Transfer, gzip, headless Chrome, cache off, production build:** `#/play` join form 324 KB (unchanged by this step); launcher `#/` 465 KB; display arena `#/arena/hero_arena` 1,698 KB before this step, 1,169 KB now (Phaser chunk 334 KB, the rest effects, floor, heroes, JS 85 KB); Hero Cards table `#/arena/hero_cards` 1,361 KB before, 832 KB now.
**Checked by eye** (headless 1920x1080 screenshots and the browser tool, mock mode): launcher tiles, arena heroes (same size and position as before), Hero Cards table, phone hand with card art, versions screen arrows. Not checked: Safari, a browser without WebP (PNG path).
**Every remaining asset over 200 KB, and where it loads:**
| Asset | Size | Loads |
|---|---|---|
| `ArenaCanvas-*.js` (Phaser and the scenes) | 1,464 KB (334 KB gzip) | arena and Hero Cards display screens, dashboard replays, `#/present`, the phone only after joining a Hero Arena match |
| `recorded-roster-match-results-*.js` | 2,927 KB (173 KB gzip) | only if the stored roster report is missing or unusable; never on the phone, not in a normal recorded run |
| `noto-sans-kr-korean-400/700 .woff2` | 530 / 546 KB | only when Korean text is on screen (the UI is English) |
| `noto-sans-kr-korean-400/700 .woff` | 850 / 867 KB | only by browsers without WOFF2 |
| `index-*.js` main bundle | 276 KB (87 KB gzip) | every screen |
| PNG originals: `arena_floor`, `rooftop`, `table` (2.0-2.8 MB each), 15 card PNGs (340-430 KB), `full_body` of Sepia, Bari and Nightcrow (209-232 KB) | | only as the fallback when WebP cannot be decoded |
| `hero_cards/summons/spirit_wisp.png` | 282 KB | not referenced by the web app at all (the table uses `turret_drone.png`, 185 KB) |
Everything else loaded on any screen is under 200 KB.

## Round 8 controls
**1. Move sends.** `InputPipeline` now sends a move at once when it is a release (0,0), a start from standstill, or a change of 150/1000 or more in the vector (direction or strength); only small changes wait for the 33 ms cap (about 30/s, still far under the 120/s/seat limit). Checked in node with a fake clock: start at 0 ms sent, a small change at 5 ms held, a direction change at 10 ms sent at 10 ms, a small one at 12 ms held, the release at 14 ms sent at 14 ms.
**2. Stick.** `lib/stick.ts`: a dead zone of 12% of the stick radius, a linear ramp to full speed at 70% of the radius, full speed beyond, direction kept (the radius is 80 px of thumb travel). The touch area is now the whole left half of the controller, top to bottom, as a floating stick: the ring appears where the thumb lands. The header, footer buttons and action buttons sit above it (checked: the "Arena: on" button is what `elementFromPoint` finds inside the left half). `touch-action: none` on the stick, and while the arena controller is on screen `usePreventPageGestures` blocks page drags, iOS pinch (`gesturestart`) and overscroll; the Hero Cards hand is left alone because it scrolls sideways. Checked with emulated touch events in headless Chrome (390x844): the stick area is 195x844 at the left edge, touching at (100,330) shows the ring there, a drag moves the knob, release hides it, a touch in the right half does nothing. Not checked on a real phone (thumb comfort, iOS Safari gestures).
**3. Buttons.** They already fired on `pointerdown` (the first event of a touch, no click, no 300 ms wait), with `navigator.vibrate(10)` and a pressed state; added `touch-action: manipulation` and no tap highlight to the buttons and the controller so the browser adds no double-tap delay or zoom. No change to the press logic.
**4. Debug readout (`?debug=1`).** `lib/netStats.ts` and `components/DebugReadout.tsx`. With `?debug=1` the phone and the display send a `ping` once a second and show the smoothed round trip to the `pong`; the phone also shows input-to-ack (the time from sending an `input.submit` to the `input.ack` with the same seq), and both show the interpolation buffer: depth (snapshots ahead of the render tick), the delay in ticks and late packets. Without the flag nothing is sent or drawn. Checked in the mock with emulated touch: phone "ping 1 ms · input→ack 1 ms · buffer 0 · delay 7 ticks · late 0", display "ping 0 ms · buffer 1 · delay 7 ticks · late 0" (the mock answers instantly and sends a frame per 6 ticks, hence delay 7). Real LAN numbers need the real server.
**5. Interpolation delay.** `lib/snapshotBuffer.ts` no longer uses a fixed 4 ticks. It measures the snapshot spacing and the jitter (how far each arrival is from when its ticks say it should come), and aims for `round(spacing + 1 + 2 x jitter)` ticks, clamped to 3..8; the delay in use moves toward that at most 2 ticks/s up and 0.4 ticks/s down, so the picture never lurches (it starts at 4). `?debug=1` shows the delay in use. Node simulation of 20 s of constant motion at 60 fps (old fixed 4 / new adaptive): steady LAN (0-3 ms jitter) delay 4 / 3 ticks with no stalls and no guessed frames either way, so 17 ms less lag; bunched Wi-Fi (25% of packets 0-80 ms late) delay 4 / 4, same guessed-frame count (60), per-frame step spread 0.014 / 0.021 units around a step of 1 (slightly rougher, no stalls); 6-tick mock cadence delay 7 / 7. Real LAN and venue Wi-Fi numbers still need a run with `?debug=1` on the real server.

## Round 8 matchup picker
**1. Picker** (`components/MatchupPicker.tsx`, `lib/matchup.ts`; in the dashboard top bar next to Run). Two hero selects; the same hero cannot be on both sides (the option is disabled on the other side, and picking it anyway moves the other side to a free hero). The default is the match a person just played (`justPlayed`, unless both played the same hero), else the largest outlier of the recorded roster report (mirrors excluded), else Bari vs Real Armor. A pick is kept for the tab (`sessionStorage`). In `?mock=1` the picker is disabled ("Sample data: the matchup is fixed").
**2. Run request.** `POST /v1/playtest/full { gameId: "hero_arena", heroes: [a, b], pairs: 100 }`. A server that answers 400 (it does not know `heroes` yet) is asked again without `heroes`, and the card says "This server can't pick a matchup yet, so it ran its default one."; 404/405 and other failures behave as before.
**3. Fair matchup.** A body with `fair: true` makes the Result card say "Fair: no patch needed" with the matchup's win rate, CI and games, and leaves out the AI patch, holdout and verdict sections; Copy summary writes "Result: Fair, no patch needed. ..." and no patch lines. Other findings (recorded) stay.
**4. Presenter.** `#/present` starts its run with the same matchup (the pick made on the dashboard, else the default; it reads the recorded roster first for the default), and R restarts with it; for a fair run its patch and verdict scenes say "Fair: no patch needed".
**Checks** (a throwaway stub server, deleted; browser tool): the default came out as Bari vs Daewi (the recorded roster's largest outlier, 99%); picking Sepia kept the sides distinct; against a stub that rejects `heroes` with 400 the request was sent twice (with, then without) and the note and fair card showed; against a stub that honours it the request carried the picked heroes and the card named "Real Armor vs Sepia"; the presenter's request carried the heroes picked on the dashboard. The matchup helpers were also run in node (played match wins, a mirror is ignored, mirrors are excluded from the outlier search). Not checked: the real engine's `heroes` and `fair` fields.

## Round 8 rejected matchup and per-target verdict
**Rejected matchup.** A 400 on `POST /v1/playtest/full` that carried `heroes` no longer triggers a retry without it, and no stored run is shown instead: the dashboard shows "The server didn't accept the matchup Sepia vs Real Armor. INVALID_SCHEMA: unknown field heroes" and the picked matchup stays selected (`ApiError.keepMatchup`; the old "ran its default" note is gone). Checked with a stub that rejects `heroes`: the error showed with the server's code and message, the picker kept both heroes, no fallback notice appeared. Network errors and other statuses behave as before.
**Per-target verdict.** `verdict.targets = [{matchup, before:{rate,ci95,games}, after:{...}, outcome}]` is parsed (`targetsFrom` in `lib/fullRun.ts`; rows that are incomplete or have an unknown outcome are dropped; absent is fine). The Result card shows one row per target under the columns: the matchup, a small bar (0-100%, the 45-55% band shaded, a hollow dot for before, a filled dot for after, joined by a line), "75% → 54%" and an outcome chip (improved green, unchanged neutral, worse red). The headline verdict badge is unchanged. The Versions detail uses the same card, so a version record whose `verdict` has `targets` shows them too; Copy summary adds one line per target. Checked in the browser against a stub run body with three targets (improved, unchanged, worse) and in node with a version record (bad rows dropped, no `targets` gives no rows). To keep the dashboard on one 1920x1080 screen with the extra rows, the replay pair is narrower (58%) and the mini-arena grid is only drawn while bots are playing. Not checked: the real analysis output.

## Round 8 hero diagnosis
**Option.** A "Diagnose heroes" checkbox next to Run (on by default when the chosen matchup is an outlier in the recorded roster report; a pick is kept for the tab and the presenter uses it; disabled with `?mock=1`). It adds `diagnose: true` to `POST /v1/playtest/full`; a 400 on a request carrying `heroes` or `diagnose` is shown as an error (no retry). The `diagnose` phase of `playtest.progress` shows as "Diagnosing heroes" with its own bar and counter under the finished baseline (`foldProgress` keeps the baseline table frozen for it too).
**Parsing** (`diagnosisFrom`, `lib/fullRun.ts`): `diagnosis = {focusHero, heroes: [{hero, overall, opponents: [{opponent, rate, ci95, games}], strength: {role, overallRate, marginPts, opponentsOutsideBand, worstOpponent}}], classification, recommendations: [{hero, role, path, direction, sizePct, why, expected}]}`; a single `recommendation` is read as a list of one; unusable heroes are dropped, missing `overall`, `strength`, `classification` or recommendations are fine, and a run without `diagnosis` shows nothing.
**Hero profile** (`components/HeroProfile.tsx`, in the Result card under the targets): the winner and the loser side by side. Each card has the hero, its role, a headline from `strength` ("Bari is +18 pts above even, beats 4 of 4 outside the fair band", "Daewi is −34 pts, loses 4 of 4"; without `strength` it says the overall win rate), and one row of bars per opponent plus the overall row (0-100% track, 45-55% band, the server's interval, the rate). Under the bars, that hero's recommendations as "Lower/Raise <field> by N%", the why and the expected result; the first one for the hero the classification applies to (strong: the winner, weak: the loser, counter-specific: the focus hero) carries a "first choice" chip, and any whose `path` is a field the AI patch changed carries "used by the AI patch". Above the cards, one line in plain words: "Bari is strong against everyone", "Daewi is weak against everyone", or for a specific counter "Bari only beats Real Armor" / "only loses to ..." (worked out from the opponents outside the 45-55% band with at least 30 games). Copy summary gets the same line and the suggestions. The dashboard drops the matches table and the idle live panel, and shrinks the replays, when a profile is on the card, so it still fits 1920x1080 (measured 1080 px).
**Presenter.** A "Hero profile" scene between the bots and the patch when the run has a diagnosis; otherwise it is left out.
**Checks:** a throwaway stub run body in the browser (request carried `diagnose: true` and the picked heroes; cards, line, chips and the dashboard height as above; the presenter listed Hero profile between Bots play and The patch and drew both cards) and node runs of the classification line (strong, weak, only beats, only loses to, mixed, none) and of the parser (garbage and absence give nothing; a single recommendation becomes a list). Not checked: the real analysis output, and the meaning of `opponentsOutsideBand` (used as the count shown; if it is something else the headline text needs adjusting).
**Shared moves.** A recommendation with `alsoAffects: [heroes]` shows "also changes Real Armor, Sepia" under its option (and in Copy summary). Confirmed by analysis: `opponentsOutsideBand` counts the listed opponents outside the fair band and n is the number listed, as the headline shows. Parser-only change, checked by type check and build; not seen on screen with a real body.

## Round 8 hero stats and sibling candidates
**1. Labels** (`lib/statPaths.ts`, used by `describePath`): `/characters/N/health` and `/characters/N/speed` read "Daewi · Health" / "Daewi · Speed" (N is the hero's place in the data, which is the order of `HEROES`: Bari, Real Armor, Daewi, Sepia, Nightcrow, matching `packages/games/action/data.js`). Anywhere such a path is shown with old → new (the patch card on the dashboard, the Result card, the Versions detail) a caption says what it may take: 60%..140% of the shipped value inside 100..3000 (health) or 30..400 (speed), e.g. Daewi speed "allowed 66–154 (±40% of the original)". The base values are a small copy of the shipped data, used only for that caption; an unknown index gets no label and no range.
**2. Siblings in Versions** (`components/VersionHistory.tsx`, `layoutBlocks`, `branchChip`): versions that share a parent are drawn side by side under a "Candidates from <hash>" heading (also in the presenter's history scene), each with a chip: chosen (accepted), "accepted, not chosen" (its note says so) or rejected, and its note ("candidate k of 2") on the row. A lone child still sits in the indented list. 
**3. Recommendations.** Speed and health recommendations list like move ones in the hero profile, with their label and range; being hero-only they carry no `alsoAffects` line (an empty `alsoAffects` is read as none).
**Checks:** node (labels and ranges for the five heroes, an unknown index, moves; block layout with a three-way sibling group, a chain and the root, chips "rejected / accepted, not chosen / chosen"); the sample history in a 1920x1080 screenshot (two siblings side by side with "chosen"). Not checked: real auto-balance output, and the engine's note text beyond "not chosen".

## Round 8 stats from the server, and the designer hand-over
**Nothing copied.** The base-value table and the assumed hero order are gone from the web. `lib/heroStats.ts` reads `GET /v1/data/hero_arena` (the current data: `data.characters[N].id` gives the hero at position N), the versions list's root record (the one with no parent) and `GET /v1/data/hero_arena?dataHash=<root>` (the base health and speed the ±40% range is measured against; with no history the current data is the base). Each screen that shows a patch (dashboard, Versions, presenter) reads them once when it mounts (not in `?mock=1`). Until they arrive a hero-stat path is labelled "Hero 2 · Speed" with no range. Checked against a throwaway stub whose character order and values differ from any local copy (position 1 was Daewi, current speed 120, root 110): the Versions detail said "Daewi · Speed 110 → 120" and "allowed 66–154", i.e. 60%..140% of the root value, not of the current one.
**Handed to a designer** (`lib/designer.ts`, `components/DesignerCard.tsx`): `needs_designer = [{hero, tried: [{label, path, old, new, outcome}], evidence}]` from the auto-balance result (or from the versions list, if the server puts it there) is parsed (absence gives nothing) and shown on the Versions screen above the history, and in the presenter's history scene, as a card per hero: the hero, the levers tried with old → new and their outcome, the evidence line when it is text, and "Numbers alone did not fix this; a designer should look." The last auto result's hand-overs are kept for the tab, so the presenter shows them after an auto run on the Versions screen, and the history scene is shown when there are any, even with a single version. Checked with a stub auto result (a Sepia card with two levers and evidence). Not checked: where the real server puts `needs_designer` beyond the auto result and the list, or an `evidence` that is not text (it is left out).

## Round 8 live screenshots
Retaken from the live demo server at its LAN address (the lobby QR shows `10.25.5.157:3000/#/join`), 1920x1080 headless Chrome, `apps/web/screenshots/live-*.png`: `live-lobby-qr.png` (real room code and QR, no players), `live-dashboard-result.png` (Bari vs Real Armor picked, Diagnose heroes on, a real run: baseline, diagnosis, holdout; verdict inconclusive, outlier 80%, hero profile with the server's recommendations), `live-versions.png` (the server's base and one candidate version), `live-arena.png` (empty arena, waiting for a match; no two players were driven). They come from the server's own web build (7dfe9b7, older than this branch), so they show that build's layout: its labels for `/characters/N/...` paths are raw paths and the dashboard is taller than 1080 px (the replays are cut off at the bottom). The run was started on the demo server (one /full run with diagnosis, about 60 s); no other server was started and the main folder was not touched. The mock shots (`lobby-qr.png` and the others) stay as layout references.

## Round 8 holdout size and sample-size wording
The live run's request now carries `holdoutPairs` equal to `pairs` (100), so the holdout has as many games as the baseline (the live run found a 100-game holdout against a 200-game gate). When a verdict reason names a sample-size cause (the analysis wording "<matchup>: only N games after the patch (need M)"), the Result card, Copy summary, the Versions detail and the presenter's verdict scene say it in plain words, e.g. "Bari vs Real Armor needs more games: 100 of 200". Checked in node on that reason text (and that other reasons and no reasons give nothing); build and type check pass; not seen with a live run after the engine change.
**Update.** The thin-holdout reason is now also read in the analysis's new wording, "<matchup>: holdout has N games; M needed" (the old "only N games after the patch (need M)" still works); both give "needs more games: N of M" (node-checked). `needs_designer` is read from the auto response and, when that lacks it, from `/v1/playtest/results/<runId>-auto.json` (using the `runId` of the auto response); an unreadable file gives no cards. Type check and build pass; the results-file read was not run against a server.
