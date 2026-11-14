# Contract v0.1.3 addendum: the designer's intended matchups

Status: accepted for the event build. It extends v0.1.2 and does not change any existing field.

## Intent file
`services/room/design/<gameId>-intent.json` = `{ version, matchups: { "<a> vs <b>": { favored: <heroId>|null, strength } } }`.
- Pair keys are written once, in either order. Mirrors and unknown heroes are rejected.
- `strength` is one of `even | slight | clear | strong`, which means a target of 50 / 55 / 60 / 65% for the favored side. A missing pair means even.
- The fair band is the target ±5 points.
- Changing the intent never changes a data hash.

## Report additions (all optional, for older reports)
| Field | Meaning |
|---|---|
| `Report.intentVersion` | the intent version the report was judged against |
| `rows[].target` | the intended win rate of the row's first hero (0..1) |
| `rows[].deltaToTarget` | the observed rate minus the target |
| `rows[].outlier` | the whole 95% CI lies outside target ±5, with n ≥ 30 |

## Rules
- A patch's per-target verdict measures movement toward each row's target.
- A "new extreme" is more than 15 points from its own target.
- A hero whose overall rate falls outside 45–55% is flagged even when every one of its matchups is as intended.

## API
- `GET /v1/design/:gameId/intent` and `PUT` the same.
- `POST /v1/playtest/reanalyze { runId, intent? }` re-judges a stored run without simulating.

## Notes from the implementation
- `rows[].target` is the target of the **alphabetically first hero** of the pair. Report rows are alphabetical, so this is the row's first hero.
- `GET`/`PUT` intent reply with `{ gameId, ...intent }`. A `PUT` without `version` gets `intent-<8 hex of the matchups hash>`.
- A reanalyze reply may also carry `reanalyzed: true`, `stale: true` (the run stopped as fair under the old intent but is flagged under the new one, so re-run it) and `diagnosisIncomplete: true`.
