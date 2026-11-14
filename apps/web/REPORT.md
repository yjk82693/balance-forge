# apps/web report

Status: all five requested items are built; `npm run build -w apps/web` passes. The real server did not exist in the repo when this was written, so **nothing here has been run against it**. Everything real-server related is written against the assumptions below.

## What to try by hand
- With the server: open `/` on the laptop, pick Hero Arena or Hero Cards, scan the QR (use the laptop's LAN address, not `localhost`), join from a phone, press Start match. Dashboard: `/#/dashboard` -> "Run 1,000 bot matches".
- Without the server: add `?mock=1` (`/?mock=1#/`). Open a lobby in one tab and `#/join` in another; the tabs talk over BroadcastChannel. Hero Cards in mock mode has a stand-in engine; an unheld seat plays itself.
- The Broken / Patched toggle (lobby and dashboard top bars) is global for the tab.

## Assumptions the server must meet (please check)
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
- The 15-row dashboard was checked at the scaled 1920x1080 layout only; the phone controller and cards hand at a 390x844 iframe. The cards screens were not re-checked after the round 3 changes except through the shared scene code.
- Replays are illustrative until the engine publishes accepted frame streams.
