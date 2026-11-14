# Change requests from packages/analysis (for the integrator)

Found by the pre-merge check (see REPORT.md, "Pre-merge check"). I did not edit any file outside packages/analysis.

## For the engine (`services/room`, `packages/games`)

1. `services/room/server.js`, `POST /v1/playtest/run`. Expected: the response also carries what the dashboard reads,
   `{baseline: Report, proposal: {patch, origin, validation: {ok, errors}}, patched?: Report, verdict: {verdict, reasons}}`,
   built with `packages/analysis` (`pipeline/pipeline.js`: `analyzePhase`, `proposeStep`, `verifyStep`). Actual:
   `{resultsPath, elapsedMs, matchCount, dataHash, recorded}`; nothing runs the analysis. Also needs a second run on the
   patched data (`storage.patch` + `runBatch`) for `patched` and `verdict`. Input to analysis is the unchanged
   `MatchResult[]` with `options.assignments`.
2. Optional, `packages/sim` `replayOnData` + room: expose per-tick observations for the baseline and patched replay of one
   recorded match, so the web can draw a real side-by-side. `before_after.json` from analysis only has HP timelines.
3. Optional, `packages/games/cards` statistics: emit `play:<cardId>` (or a per-card entry) so `analyzeCards` can report
   per-card play rate and win rate. Now only `play` and `end_turn` exist.

## For the web (`apps/web`)

1. `src/lib/api.ts` `subscribeProgress`: the engine payload is `{runId, gameId, dataHash, matchesDone, totalMatches,
   elapsedMs, matchups: [{matchup, heroes, wins: {hero: n}, games, draws, invalidMatches}]}`; the code reads
   `done`, `total`, `rows`. Map `done = matchesDone`, `total = totalMatches`, `rows = matchups.map(m => ({dimension:
   m.matchup, wins: m.wins[m.heroes[0]], games: m.games}))` (`heroes[0]` is the alphabetically first hero, the same
   focal side as the Report row).
2. `src/lib/api.ts` `runPlaytest`: request body `{gameId, matches}`; the room expects `{gameId, pairs}` (integer 1..1000).
3. `src/lib/api.ts` `ORIGINS`: analysis writes `fake`, `gemini`, `grok`, `fallback`. Add `fake` and `grok` (label them
   honestly) instead of showing them as `manual`.
4. `src/components/WinRateChart.tsx` `parseMatchup` and rows: report rows whose `dimension` starts with `human: ` are the
   human group, not a bot matchup. Filter them out of the bot chart and show them in the human row (count is
   `Report.humanMatches`; detail is in `human_group.json`).
5. `src/lib/recorded.ts`: imports `recorded-match-results.json` (old: two dataHash values, no `options.assignments`) and
   hard-codes `ci95: [0, 1]` and `outlier: false`. Use `recorded-roster-match-results.json` and
   `recorded-roster-metrics.json` and compute rows with `packages/analysis` (`analyze`), or at least Wilson 95% intervals.
6. `src/lib/contract.ts` `MatchConfig`: add optional `options?: { assignments?: Record<string, string> }`.
7. `src/components/CompareReplay.tsx` / `replayGen.ts`: use `before_after.json` (`before.timeline` / `after.timeline`:
   `[{tick, hp: {p1, p2}}]`, `maxHp` per seat) for the HP numbers instead of the mock damage table when it is available.

## For the engine: per-action damage and hits through guard (Round 7, evidence blocks)

Needed so the evidence for an outlier row can say which move produces the imbalance, for example whether projectiles
get through a guard. Today `MatchResult.statistics.players[].actions[]` holds only `{actionId, opportunities, uses}`, and
damage exists only as one total per player, so `src/evidence.js` can show use rates and damage share but not damage by move.

- File: `packages/games/action/index.js` (`statistics`, built from `payload.statistics`), the `statisticsDelta`/`emptyStatistics`
  helpers in `packages/sim/index.js`, and the `Statistics` shape in `packages/contracts/schema.js`.
- Field: add to each entry of `statistics.players[].actions[]`, as optional non-negative integers:
  - `damage`: total damage dealt by hits of this action, after mitigation (the per-action parts sum to the player's `damage`);
  - `hits`: number of hits of this action that landed;
  - `hitsThroughGuard`: how many of those hits landed on a target that was guarding at that tick and were not blocked.
- Expected: `{"actionId": "projectile", "opportunities": 2815, "uses": 1578, "damage": 61200, "hits": 940,
  "hitsThroughGuard": 310}`. Actual: no `damage`, `hits` or `hitsThroughGuard`.
- Analysis side: `evidence.json` already has `damage: null` per action and lists `damageByAction` and `hitsThroughGuard` under
  `missing`. When the fields exist I will fill them from the recorded results; I did not guess them from totals.
