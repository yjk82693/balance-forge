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
