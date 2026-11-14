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
