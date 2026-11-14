# Sepia Tentacle Run (gameId `tentacle_run`), contract note v0.1.5 (draft by the engine owner)

Solo run, one seat `p1` (Sepia), realtime, 60 Hz, integer math, seeded (xorshift32), deterministic. Types:
`packages/contracts/types.ts` (`TentacleRules`, `TentacleWave`, `TentacleObservationPayload`, ...).

## Actions (ActionInput.actionId, params)
- `move` `{moveX, moveY}` -1000..1000 (the stick). Held like Hero Arena's move on the server (the last non-zero vector
  repeats on ticks without a new move); send `{0,0}` to stop.
- `latch` `{aimX, aimY}` -1000..1000: aim at the nearest post within `latchRange` in that direction (a cone of 45 degrees
  around the aim); the tentacle pulls Sepia to it at `latchSpeed` per tick, she is invulnerable for
  `latchInvulnerableTicks` after the latch starts, then `latchCooldownTicks` of cooldown. No post in the cone: no latch.
- `whip` `{aimX, aimY}`: damage `whipDamage` to every enemy within `whipRange` in the aimed half plane, cooldown
  `whipCooldownTicks`.

## state.view payload
`TentacleObservationPayload`. `wave` is 1..5 for the waves and 6 for the Man-Shark boss: the wave being fought, or the one
about to start during a break (`breakTicks` > 0, no enemies; the run starts with a break before wave 1). While latched,
`entities[0].latch = { post, untilTick }` and the scene draws the tentacle from Sepia to `posts[post]`. The boss has
`kind: "boss"` in `entities` and the summary in `boss` (`hp`, `maxHp`, `phase` 0..2: pips of the HP bar).
Projectiles are `from: drone | sentry | boss`.

## Outcome and statistics
`outcome.reason`: `death`, `boss_down` (win) or `max_ticks`. Statistics (`MatchResult.statistics`): the usual
`players[0].actions` for `move`, `latch`, `whip`, plus per wave N (1..6, 6 = boss) three entries:
`wave:N:reached` (uses = 1 if reached), `wave:N:cleared` (uses = 1 if cleared, opportunities = 1 if reached) and
`wave:N:damage` (uses = hit points taken in that wave). `durationTicks` is the time of the run.

## Data (`GameData.gameRules`)
`TentacleRules`. `gameRules.waves[N]` = `{ walkers, drones, sentries, enemySpeed, enemyDamage, fireIntervalTicks, flaw? }`.
Patch paths (contract v0.1.5): `/gameRules/waves/N/(walkers|drones|sentries|enemySpeed|enemyDamage|fireIntervalTicks)`,
integers, N 0..4 (the boss is not patchable). Bounds are listed in `packages/games/tentacle/SPEC.md` once the game is
finished and agree between the analysis validator and the engine `applyPatch`.
