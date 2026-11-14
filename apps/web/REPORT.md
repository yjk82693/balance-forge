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
