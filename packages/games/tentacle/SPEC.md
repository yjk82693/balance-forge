# Sepia Tentacle Run (gameId `tentacle_run`), contract note v0.1.5 (draft): a 2D side-scrolling wire runner

Solo run, one seat `p1` (Sepia), realtime, 60 Hz, integer math, seeded (xorshift32), deterministic. Types:
`packages/contracts/types.ts` (`TentacleRules`, `TentacleSection`, `TentacleObservationPayload`, ...).

## World
Side view. x grows to the right (the course runs from x = 0 to `finishX`), y grows UP with the ground at y = 0. Sepia
auto-runs right at the current section's `runSpeed` (units per tick). Six sections end to end (the sixth is the
Man-Shark chase, `shark` in the view). The camera shows `[cameraX, cameraX + 16000]`, `cameraX = max(0, player.x -
4000)`.
Obstacles (generated at the start of the run from the seed and the section data):
- `pit`: a gap in the ground (jump over it; falling in is death);
- `lowBar`: a bar in the air (slide under it; standing or jumping into it is death);
- `wall`: a block on the ground you cannot jump over (use the wire to swing over it);
- anchors: overhead posts every `anchorSpacing` units the wire can attach to.

## Input: the action `control`
`ActionInput { actionId: 'control', params: { jump: 0 | 1, slide: 0 | 1 } }` sent through the normal `input.submit`
envelope
(`playerId: 'p1'`, `tick = view.tick + 1`, `turnId: 0`, increasing `seq`). The game keeps the last control until a new
one
arrives, so the phone sends it only when a button changes: jump pressed/released, slide pressed/released.
- jump pressed on the ground (a tap): jump. Jump still held for `tapTicks` (12) in the air with an anchor in
  `wireRange` ahead: the wire attaches and Sepia swings like a pendulum; releasing jump lets go with the momentum.
- slide held on the ground: Sepia slides (low enough for a lowBar).

## state.view payload
`TentacleObservationPayload`. `player.state` is `running | jumping | sliding | swinging`; while swinging `player.wire`
gives `{anchorId, anchorX, anchorY, length}` (draw the tentacle from Sepia to the anchor). `obstacles` and `anchors`
are only those near the camera. `shark` is null until the last section.

## Outcome and statistics
`outcome.reason`: `pit`, `obstacle` (death), `finish` (win) or `max_ticks`. Statistics: `players[0].actions` has
`control` plus, per section N (1..6), `wave:N:reached` (uses = 1 if reached), `wave:N:cleared` (uses = 1 if the section
was run to its end, opportunities = 1 if reached). (The ids keep the word "wave": the analysis and the dashboard read
them.)

## Data (`GameData.gameRules`)
`TentacleRules`. `gameRules.sections[N] = { length, pits, lowBars, walls, anchorSpacing, runSpeed, flaw? }`.
Patch paths (contract v0.1.5): `/gameRules/sections/N/(length|pits|lowBars|walls|anchorSpacing|runSpeed)`, integers,
N 0..5; bounds are listed in `packages/contracts/semantics.ts` and the analysis validator agrees (cross-check test).
