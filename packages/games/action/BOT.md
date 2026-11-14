# Arena bot policy

scripted-0.2.1 uses the simulation project's xorshift32 implementation in a separate bot-only stream.
Call deriveBotSeed(config.seed, seatIndex) once per seat and pass that uint32 to
chooseActions(view, seq, variant) on every tick. A seat keeps its seed through reconnects.
chooseAction(view, seq, variant) remains a deprecated attack-only alias for old callers.

Six per-match draws select reaction delay (0–12 ticks), guard-attempt probability (55–95%), engagement distance,
strafe direction and horizontal/vertical projectile aim offsets. Projectile IDs select stable subsequent draws
for guard attempts, independent of how often a caller polls the same view. Reaction delay is measured from the
first predicted threat window (guard startup plus four ticks of margin plus twelve ticks of reaction allowance).
A slower reaction waits further into that window. Only legal guards can replace the existing attack preference.
The policy considers hostile projectile paths without consulting guard-bypass traits or branching on hero IDs.
No draws consume simulation-state RNG. Recomputing decisions from seed/view/seq requires no hidden bot memory.


## scripted-0.2.2 (candidate, not adopted)

bot-0.2.2.js is a candidate policy; the runner, the room and the recorded files still use scripted-0.2.1. It changes two
things and leaves the rest (draw order, guard attempts, aim offsets, seat seeds from deriveBotSeed) as it is:

1. The seeded stand-off distance is drawn from the hero's own reach. A hero whose strongest attack move is a melee move
   closes to 60-95% of the melee range (1140-1805 for meleeRange 1900). A hero whose strongest attack is a projectile
   stays at 20-40% of the projectile range, which is projectile speed x life capped by the arena width (3200-6400). The
   strongest attack is read from the hero's moves in the game data, so there is no hero branch: with the current
data only
   Daewi is melee-first (heavy_melee 62 against projectile 44). 0.2.1 drew 1200-3600 for every hero, which left
melee heroes
   standing outside their own reach and throwing swings that could not hit (about 70% of all swings in Daewi vs Real
Armor).
2. A melee swing is never started when the target is outside the melee range. Projectiles are unchanged.

Adopting it changes every recorded number, including the designed Bari vs Real Armor flaw, so it needs a decision
and one
regeneration of the recorded files (and a new botPolicyVersion in their metadata). Tests: bot-0.2.2.test.js (unit only).
