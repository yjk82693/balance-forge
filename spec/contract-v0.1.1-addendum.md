# Contract v0.1.1 addendum (integrator decision, Nov 13 21:45)

Backward-compatible, **optional** fields only. v0.1 data stays valid. Requests came from `packages/games/action/CHANGE_REQUEST.md` and `apps/web/CHANGE_REQUEST.md`.

1. **MatchConfig.options (optional, closed):** `{ "assignments": { "<playerId>": "<heroId or deckId>" } }`. Per-match character assignments live here, not in GameData, so every roster matchup and seat-swapped pair shares **one dataHash per content version**. Analysis groups by dataHash and pairs by seed; a patch creates exactly one new dataHash.
2. **WebSocket additions:**
   - `room.join` (controller → server): `{ joinCode, name, hero }`
   - `room.status` seats may carry an optional `hero`; a reply addressed to a joiner carries an optional `you: "<seat>"`
   - `match.reset` (display → server): the lobby returns to a clean state. Leaving is a plain disconnect.
3. **Hero Arena action catalog:**
   - `move` takes `{ moveX, moveY }` in −1000..1000
   - `melee`, `projectile` and `guard` take `{ aimX, aimY }` in −1000..1000
   - `actions.available` remains the source of truth
4. **Observation entities** may carry `maxHp`.
5. **Report (optional fields):** `elapsedMs` (integer), `recorded` (boolean), `createdAt` (ISO string), `humanMatches` (integer). The dashboard shows `recorded · N matches · T s` when present.
