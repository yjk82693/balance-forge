# Tentacle Run runner: state at the pause (engine branch, not merged)
- Core, bot and room input work: first jump press jumps, a second press in the air fires the hook, release lets go.
- Bot (tentacle-bot-0.2.0, double-press): 60-run check, sections 1-4 clear 97 / 95 / 80 / 11%; the flaw is section 4.
- Patch paths /gameRules/sections/N/(pits|lowBars|walls|anchorSpacing|runSpeed); the stand-in shrinks anchorSpacing x0.65.
- Open: example-full.json is still the old top-down example; README text; art, animation and anchor feel are the web's.
- Full suite on this branch: 492 tests, 483 pass, 0 fail, 9 skipped; tsc 0.
