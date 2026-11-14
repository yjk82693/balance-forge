# Engine implementation report

Branch: engine. Completed stages 1–5 on 2026-11-13. The user's updated rule waives commits in this sandbox; this
resumed run made no Git metadata writes. No dependencies added, network used, push attempted, UI changed, external
implementation/assets imported, or files outside the four owned directories edited.

## 1. Contracts — complete

- Normative v0.1 schema copied exactly from spec/contract-v0.1.md, with TypeScript declarations for every wire type and
GameAdapter. Previous declaration-generation recursion issue resolved.
- Canonical full-state JSON: Unicode code point key ordering, retained array order, safe integers only,
negative-zero/undefined/cycles/sparse arrays rejected; UTF-8 SHA-256 lowercase hex.
- Registered closed, bounded schemas for action/cards state, observations, rules, and action parameters.
- Shared helpers check content IDs/provenance/references, pinned config/version/data hashes, frame
ordering/seat/tick/turn/action domains, adapter legality, outcome seat references, exact snapshot compatibility and
restored hashes. Numeric patch application is allowlisted and bounded; it never executes proposal text.
- Fixture tests cover match config/results, observation, both reports, patch proposal, and relevant WebSocket payloads.
Fixture values remain illustrative and were not reused as measured results.

## 2. sim + games/action — complete

- xorshift32-v1 with reference-vector test and zero-seed rejection; explicit integer division and stable entity
iteration. No clock, ambient random, network, or floating-point state.
- Authority owns simulation state. Bots and controllers submit the same ActionInput; duplicate accepted sequences
return the original receipt, invalid/late/stale input is rejected, absent realtime input is neutral. Accepted frames
can be replayed to the same hash.
- Four original heroes: bari, real_armor, daewi, sepia. Three action archetypes: melee, projectile, guard. Weight-tier
startup/recovery/cooldown/stun/knockback/hit-stop, projectile lifetime/collision, shield/guard and additive statistics
implemented.
- Bari spirit_arrow's intended guard bypass is gameRules.moveTraits data, tested against ordinary blocked projectiles
and against disabling the data flag. No hero-ID exception branch.
- Each match ends by tick 1800. Runtime snapshots include config, PRNG, pending attacks, projectiles, cooldowns,
timers, terminal outcome and cumulative statistics. Public observations omit PRNG and private config.

## 3. Determinism — passed

- 100 seeds × 1,000 ticks × two independent executions = 200,000 simulation steps.
- Four hero combinations are exercised. Health is raised within schema bounds to sustain active combat for all 1,000
ticks.
- Each run independently generates public-observation bot inputs with the same seeded policy variation. Both input
frames and SHA-256 state hashes match at every tick.
- Most recent complete determinism test: 45,311.345791 ms, no mismatch.

## 4. services/runner — complete, measured

- worker_threads batch runner, fixed seed pairs with physical-seat hero assignments reversed, stable job/result order,
immutable data pins, scripted observation-only bots.
- One-worker and two-worker results match exactly. Match errors produce valid:false with an error code and no draw/win
credit; worker process errors reject the batch and clean up workers.
- MatchResult exports use the exact fixtures/match_results.json wire shape.

Recorded command:

```
node services/runner/cli.js --pairs 100 --workers 2 --out services/runner/recorded-match-results.json --metrics
services/runner/recorded-metrics.json
```

Actual recorded sample: Bari versus Real Armor, seeds 1–100, both seat assignments; 200 matches, 200 valid, 0 invalid,
0 draws. Match lengths: 344–388 ticks. Elapsed 3,421.499208 ms; throughput 58.453908 matches/s with 2 workers,
including worker startup/bot/simulation/hash/result transfer and validation, excluding output serialization. Metadata
labels this recorded and includes match count, elapsed time, seed list, worker count and bot policy version. This is a
throughput sample, not a human balance claim.

## 5. games/cards — complete core

- Shared adapter/ActionInput; energy 3 per turn, private hand of 5, seeded deck shuffle/refill, 2 dense summon slots.
- Interpreted “6 turns” as 6 turns per player: six rounds, 12 resolved individual turns. Playing a card increments
tick; only end_turn, zero energy or an authoritative timeout resolves the active turn and increments turnId. Highest
remaining health decides the round cap, tied health draws.
- Hypnosis bypasses ward via immutable card data and suppresses opposing summons for their next turn. Ordinary damage
respects ward.
- No opponent hand/deck order or RNG in observations. Public played-card events reveal only the played card. Observe
uses only serialized state, with no process-local catalog dependency.
- Tests cover privacy, seeded initialization, energy/slots, asymmetric effects, rejected-input immutability, timeouts,
six-round termination, snapshots, full scripted play and replay.

## Tests executed

- `node --test`: 24 passed, 0 failed; 45,510.931708 ms. Includes contracts 4, action 6, cards 6, shared
boundary/security 3, PRNG/determinism 2, runner 3.
- After the final schema-registration-only completion, `node --test packages/games/action/*.test.js
packages/games/cards/*.test.js`: 12 passed, 0 failed. No simulation rules or state transitions changed after the full
determinism run.
- Earlier staged secrets check scanned zero files because Git staging was blocked. No new commit or
staged-secrets-check claim is made under the updated no-commit rule.

## Integration notes

Public adapter entry points: packages/games/action/index.js and packages/games/cards/index.js. Authority/replay
helpers: packages/sim/index.js. Runner entry points: services/runner/index.js and cli.js. Usage and controls are
documented in packages/sim/README.md and services/runner/README.md.

v0.1 has no per-match hero assignment field. Current compatible selection lives in immutable GameData.gameRules.seats,
so seat-swapped variants have distinct dataHash values. Analysis must preserve this distinction. A proposed optional
v0.2 config extension is recorded in packages/games/action/CHANGE_REQUEST.md; shared spec/fixtures were not changed. No
remaining execution blocker.

## Expanded engine verification

Round 3 added finished-match replay archives, a data-only fifth arena hero, a private next-card peek deck,
worker progress, deterministic view events, and ten-second seat reconnect. Assignments use the approved optional
MatchConfig.options; the older seat-in-GameData limitation above is resolved. See services/room/REPORT.md for
per-step results and current measured runs. Full node:test run: 68 passed, 0 failed, 5 no-network listener skips.
