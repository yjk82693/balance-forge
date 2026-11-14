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
