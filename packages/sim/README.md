# Deterministic simulation

Node ESM, built-ins only. `xorshift32` implements xorshift32-v1 (nonzero uint32 seeds). Game adapters are pure; Authority owns state and accepted frame history. Controllers and bots use the same ActionInput. Authority deduplicates accepted sequence receipts and rejects late, stale, unauthorized, or additional same-tick input. Turn timeout frames are supplied only by the authority. Adapters never use I/O or wall clocks during step.

`node --test packages/contracts/*.test.js packages/sim/*.test.js packages/games/action/*.test.js packages/games/cards/*.test.js services/runner/*.test.js`

Public adapter entry points: packages/games/action/index.js and packages/games/cards/index.js. Each exports describe, initial, observe, legalActions, step, outcome, statistics, hash, data, makeConfig, and adapter. Data is frozen when pinned. Snapshot restore requires exact config/content identity, a registered payload schema, and a matching full-state hash. Events with empty audience are public.

Action controls have three IDs: melee, projectile, guard. Optional moveX/moveY axes are integer -1000..1000 on each accepted action; projectile requires aimX/aimY in that domain with a nonzero aim vector. Missing input is neutral. Positions use thousandths of a world unit. Timings and cooldowns use logical ticks; hit-stop freezes simulation timers while the logical tick still advances. Maximum match length is 1800 ticks; surviving players draw at the cap. Weight tiers and the spirit_arrow guard exception are content data. Character selection is in gameRules.seats; see the action CHANGE_REQUEST for its v0.1 limitation.

Cards use play {handIndex, slot?} and end_turn {}. A summon must specify the next free dense slot (0 or 1). Energy starts at 3 each turn, hand refills to 5, and summons attack at their owner's turn end. Card plays increment tick, but only end_turn/zero energy/timeout increments turnId. Six rounds give each seat six turns. Remaining health breaks ties after round six. Only a viewer's own hand is exposed; deck order and RNG remain private. Hypnosis bypasses ward and sleeps enemy summons for one enemy turn.
