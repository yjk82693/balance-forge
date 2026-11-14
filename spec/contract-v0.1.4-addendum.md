# Contract v0.1.4 addendum: card-game patches and statistics

Status: accepted for the event build. It extends v0.1.3 and does not change any existing field.

## Statistics
- Hero Cards `MatchResult.statistics.players[].actions` adds `play:<cardId>` rows.
  - `uses` counts plays.
  - `opportunities` counts the turns the card was in hand and playable.
- simVersion `cards-0.1.2`.

## Patch paths (Hero Cards)
| Path | Meaning | Bounds |
|---|---|---|
| `/gameRules/cards/N/cost` | energy cost of card N | integer 1..3 |
| `/gameRules/cards/N/power` | power of card N | integer 1..10; not allowed on the peek card |

- Indexes have no leading zeros.
- A proposal has at most 8 replacements and is pinned to `baseDataHash`.
- The engine's `applyPatch` and the analysis validator agree on every case.

## Card analysis
- For each deck: per-card play rate, the win rate when played vs not played, and Wilson CIs.
- A card is dominant (or weak) when its whole played-CI lies above (or below) its own deck's whole win-rate CI. Judging a card against its deck instead of 50% avoids flagging every card of a stronger deck.
- `/v1/playtest/full { gameId: "hero_cards" }` probes cost and power ±1 for every card on fresh seeds, and uses the significant levers as the diagnosis.
