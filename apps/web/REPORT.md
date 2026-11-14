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
- **Not verified at a true 1920x1080 or 390x844.** The browser window resize reports a 1512x801 viewport. I checked screens at that size, and the phone screens inside a 390x844 iframe (join form, arena pad, hero picker). Light theme was not checked on screen. The dashboard scrolls about 100px at 1512x801; at 1920x1080 it should fit, but I did not confirm.
- The join form cannot know the game before joining, so Nightcrow is always shown as "planned" there (right for the arena, wrong for cards).
- The dashboard canvas still plays the sample Observation loop; the matches table in real mode shows only bot and human totals. There is no per-match list API.
- `lib/cards.ts` mirrors card ids, costs and powers from `packages/games/cards/data.js` for labels and art only. Card art uses the viewer's hero (`{hero}_{attack|guard|signature}.png`); the cards observation has no hero field.
- Cards HP shows `/20` from the rules because the cards observation carries no `maxHp` yet (arena uses `maxHp`, else 100).
- Real transport: backoff reconnect only; a reconnecting controller re-sends `room.join` and relies on the server giving the seat back. No server-side `reconnect` message is used.
- No automated UI tests were added.
- Hero Cards on the laptop is a Phaser scene (kit PNGs stay inside Phaser, per docs/ui-tone.md); the phone hand is code-drawn with card art as images.
