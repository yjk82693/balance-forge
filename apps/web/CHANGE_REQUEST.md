# Change requests from apps/web (for the integrator)

1. **room.status seats: optional `hero`; reply to a joiner: optional `you`.** The lobby shows hero portraits, so a seat needs a hero. The reply addressed to a joining controller carries `you: "<seat>"`.
2. **Controller messages not in the contract table:** `room.join` payload `{ joinCode, name, hero }`; `match.reset` (display → server, lobby returns to a clean state). Leaving is a plain disconnect.
3. **Action catalog for Hero Arena:** controllers send `move` with `{ moveX, moveY }` in -1000..1000, and `melee` / `projectile` / `guard` with `{ aimX, aimY }`. Only `projectile` with aim params appears in fixtures; `move` is assumed. Please confirm against `actions.available`.
4. **Max HP:** observations carry `hp` but no max; the UI shows HP out of 100 until the engine publishes it.
5. **Report fixtures have no run time**, so the dashboard shows `recorded · 200 matches` plus a `sample data` badge, without a duration.
