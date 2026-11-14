# Deterministic simulation

Node ESM, built-ins only. xorshift32-v1 uses nonzero uint32 seeds. Adapters never read a clock or ambient RNG.
Authority owns state, receipts and accepted frame history; clients and bots share ActionInput.
Rejected inputs never mutate simulation state. Arrays/entities have stable order; full state uses integer values.

Game adapters: packages/games/action/index.js and packages/games/cards/index.js. Each exports describe, initial,
observe, legalActions, step, outcome, statistics, hash, data, makeConfig and adapter.
Character/deck assignments use MatchConfig.options.assignments; seat swaps share an immutable content hash.
Data is frozen when pinned. Snapshots require exact config/version/content identity and a registered payload schema.

Arena has five heroes and four action IDs. `move {moveX, moveY}` uses integer axes -1000..1000 independently of
startup/recovery/cooldown. `melee`, `projectile`, `guard` use bounded aimX/aimY. Projectile aim cannot be zero.
A frame accepts one move plus one attack per seat with distinct sequences; other games accept one action per seat.
Movement consumes no cooldown and is absent from attack uses/opportunities. Stun/elimination prevents movement;
missing movement is neutral. Attacks, projectiles, shield, stun and hit-stop use logical integer timing.
Matches end by tick 1800. Nightcrow uses existing archetypes/effects; spirit_arrow remains the only guard bypass.
Positions use thousandths of a world unit. Ordered public events do not alter state hashes or consume RNG.

Cards use `play {handIndex, slot?}` and `end_turn {}`. Energy is 3, hand size 5, summon slots 2.
A summon uses the next free dense slot. Six rounds give each seat six resolved turns; remaining health breaks ties.
Only end_turn/zero energy/authoritative timeout advances turnId; every accepted play still increments tick.
The nightcrow deck has mechanical crows and a generic peek effect. Opponent deck order/hand/RNG stay private;
a peek reveals one next-card identity only to its owner until the next turn boundary. Hypnosis rules are unchanged.

`replay(adapter, config, data, frames)` restores the same full state from accepted frames.
`replayOnData(adapter, recording, data)` changes the content pin for counterfactual playback; illegal frames throw.
No input is silently replaced. Replays must retain both base and candidate data hashes for meaningful comparison.

Run `node --test`. The 100-seed test independently generates input streams and compares 1000 tick hashes twice,
using legal high health values to keep combat active throughout. Readability tests enforce 120 columns here and
in packages/games. Room and worker usage is documented under services/room and services/runner.
