# Contract v0.1.2 addendum: hero stats in the patch allowlist

Status: accepted for the event build. It extends v0.1.1 and does not change any existing field.

## Why
Measured on the five-hero roster, a weak hero can lose for reasons that move power does not reach: it is too slow to close in, or too fragile to trade hits. Raising Daewi's own heavy-melee power by 30% left every Daewi matchup unchanged (n = 200 each). Health and speed are numbers that belong to one hero only, so changing them never affects another hero.

## Allowlisted paths (PatchProposal.changes[].path)
| Path | Meaning | Bounds |
|---|---|---|
| `/moves/N/power` | power of move N (may be shared by several heroes) | 0..10000 (unchanged) |
| `/tuning/damageScalePermille` | global damage scale (all heroes) | 100..3000 (unchanged) |
| `/characters/N/health` | health of hero N | 100..3000, and within ±40% of the base data value |
| `/characters/N/speed` | movement speed of hero N | 30..400, and within ±40% of the base data value |

Rules that still hold:
- Values are integers.
- A proposal has at most 8 changes and is pinned to `baseDataHash`.
- Validation rejects any other path.
- The ±40% bound is measured against the root version of the data, so repeated rounds cannot drift a hero further than that.

## Recommendations
Health and speed are hero-only levers (`alsoAffects: []`). The diagnosis may rank them alongside the hero's own attacks. Shared moves still rank below hero-only levers.
