# packages/analysis report

Branch `analysis`. 80 `node:test` tests, all offline: `node --test packages/analysis/test/*.test.js`.
No dependencies added, no network calls in tests, nothing pushed.

## What exists

| Area | Files | Notes |
|---|---|---|
| Analyzer, Wilson, outlier rule | `src/analyzer.js`, `src/wilson.js` | Hero-aware rows when `config.options.assignments` exists (addendum 1), else players joined. Focal side = alphabetically first hero. |
| Grouping, seed pairing | `src/group.js` | `groupByDataHash`, `pairBySeed` (same dataHash + seed + matchup, both valid, seats swapped). |
| Pipeline + CLI | `pipeline/pipeline.js`, `pipeline/cli.js` | `analyzePhase`, `proposeStep`, `verifyStep`; CLI `propose`, `verify`, `run`. |
| Validator, verdict | `src/validator.js`, `src/verdict.js` | Unchanged rules; human rows never gate a verdict. |
| Adapters | `src/adapter.js` (fake), `src/llm.js` (Gemini, Grok, fallback), `src/adapters.js` (factory) | Fake is the default. |
| Report extras, human rows | `src/extras.js`, `src/human.js` | `elapsedMs`, `recorded`, `createdAt`, `humanMatches`; rows prefixed `human: `. |
| Hero Cards | `src/cards.js` | Play rate, played vs not-played win rate, dominant/weak flags. |
| Storage | `src/storage.js` | `JsonFileStorage`; `TigerDataStorage` throws "not implemented" and is not wired. |

CLI output folder: `report_baseline.json`, `patch.json` (a plain PatchProposal), `report_patched.json`, `verdict.json`, plus `pipeline-meta.json` (patch origin, fallback reason, pairing counts).

## Behaviour worth knowing

- **One dataHash per phase.** Baseline and holdout each must contain exactly one dataHash among valid matches; otherwise the pipeline stops with an error. A patch makes exactly one new hash.
- **Pairing.** With assignments, only complete seat-swapped valid pairs count toward rates. A valid match whose partner is invalid or missing is dropped from rates and counted in `pipeline-meta.json` as `unpairedMatches`. Invalid matches stay in `invalidMatches`.
- **Adapters.** Timeout 8 s per attempt (AbortController), one retry, then the offline fake with `origin: "fallback"` and a short `fallbackReason`. A proposal that fails `validatePatch` (wrong hash, bad path, out of range) also falls back. Keys come only from `GEMINI_API_KEY` / `XAI_API_KEY`; Gemini's key goes in a header, never the URL; error text never includes bodies or keys. The prompt holds only aggregate bot rows and the allowlisted paths.
- **Origin is not in PatchProposal** (the schema is closed), so it is recorded in `verdict.json` (`patchOrigin`) and `pipeline-meta.json`.
- **Human rows** are excluded from the LLM prompt and from verdict gates; they are appended after bot rows and do not change `validMatches`.

## Problems and assumptions to resolve

1. **Current runner output cannot go through the pipeline.** `services/runner/recorded-match-results.json` still uses the v0.1 per-seat dataHash variants and has no `options.assignments` (two hashes, no hero names). The pipeline rejects it on purpose. The engine needs to switch to addendum item 1 before the end-to-end path works on real runs. My tests use synthetic paired results shaped like `fixtures/match_results.json`.
2. **`services/room/human-results.json` does not exist yet.** I assumed it is a `MatchResult[]` (or `{results: [...]}`), the same shape as the `match.ended` payload. If the room service writes something else, only `humanResultsOf` in `src/human.js` needs to change.
3. **Hero Cards statistics lack per-card ids.** The cards engine emits only `play` and `end_turn` actions. `analyzeCards` expects `play:<cardId>` actions (opportunities = card playable, uses = card played). Until the engine emits those, the analysis returns no cards. This is an engine-side change (the `engine` branch); I did not touch it.
4. **Gemini and Grok request shapes are untested against the live APIs.** No keys, no network. Endpoints, header names, `responseSchema` / `json_schema` formats and the default model names (`gemini-2.5-flash`, `grok-4`; override with `GEMINI_MODEL` / `XAI_MODEL`) come from my memory of the public docs. Please do one live smoke run with real keys before the demo; a mismatch will show up as `origin: "fallback"` with a reason, not as a crash.
5. **Win rate semantics.** Row win rate = focal hero wins / valid paired games, draws count as games. The "recorded" badge needs `--metrics` with `kind: "recorded"`; nothing marks a report as recorded by default.
6. A fake-adapter proposal is a fixed `/moves/1/power -> 72` regardless of the report. It exists to keep the path working offline, not as analysis.

## Round 3 (high-end quality pass)

Order of work: H, N, J, K. Tests: `node --test packages/analysis/test/*.test.js` (84 pass after the polish pass, offline).

### H. Before/after replay (`src/replay.js`, `pipeline/arena-simulator.js`, CLI `replay`)
- `pickLopsidedMatch`: most lopsided matchup (largest distance from 50%), then the most one-sided win by its dominant side (damage margin, shorter, lower seed, matchId). Deterministic.
- `buildBeforeAfter`: re-simulates the same seed, seats and bot policy twice: on the unchanged data (must reproduce the recorded `finalStateHash`, else `REPLAY_MISMATCH`) and on the patched data (new dataHash). Output `before_after.json`: `{kind, seed, players, heroes, selection, patch, before, after, delta}`; each side has `outcome`, `durationTicks`, `finalStateHash`, `maxHp`, and an on-change `timeline: [{tick, hp: {p1, p2}}]` (first sample tick 0, last = final tick).
- The simulator is injected; `pipeline/arena-simulator.js` is the only engine-bound code. It mirrors `services/runner/match.js` and is loaded lazily from `packages/games/action` (read-only import). It was written against the engine on `main` (seat heroes in GameData). If the `engine` branch changes the bot signature or the `initial/step/observe` API, only that file changes.
- With the v0.1 runner output, `resolveDataVariants` maps both seat variants from one base GameData; the patch's `baseDataHash` decides which variant is replayed.

### N. 5x5 matchup table (`src/matchups.js`)
- `buildMatchupTable(results, {roster})`: N x N cells, N(N+1)/2 distinct matchups (5 heroes -> 10 pairs + 5 mirrors = 15), `missing` lists matchups with no games. Each cell is from the row hero's side, with its own wins, losses, draws, Wilson interval and the unchanged outlier rule (n >= 30, whole interval outside 45-55%). Mirror cells show the seat-1 advantage.
- The roster is data (nightcrow is just another hero id); heroes outside a given roster are an error. The CLI writes `matchup_table.json` (`--roster a,b,c` to fix the order).
- Mirror matches count one by one in seed pairing (a seat swap changes nothing).
- Nightcrow itself is not in the engine's GameData yet (engine side); the tests use synthetic results.

### J. Human group (`src/human.js`)
- `buildHumanGroup`: one group per matchup, label `Humans: Bari vs Real Armor 4–1 (n=5)` (draws shown, e.g. `4–1, 1 draw`). Under 30 games: `smallSample: true`, `outlier: false` and the note "Only 5 games. Too few to call a trend; 30 or more are needed before it counts." From 30 games the note shows the Wilson interval and the outlier rule applies. The CLI writes `human_group.json`. The Report schema is closed, so the label and note live in this file, not in Report rows (rows stay `human: <matchup>`).

### K. Error results
- `src/errors.js`: `AnalysisError(code)`, `safely(fn)`, codes `INVALID_INPUT, INVALID_JSON, IO_ERROR, NO_RESULTS, MIXED_DATAHASH, INVALID_REPORT, INVALID_PATCH, PATCH_BASE_MISMATCH, PATCH_PATH_MISSING, NO_DECISIVE_MATCH, DATA_HASH_MISMATCH, REPLAY_MISMATCH, SIMULATION_FAILED, ENGINE_UNAVAILABLE, ADAPTER_FAILED, USAGE, INTERNAL`.
- Raw functions throw `AnalysisError` with these codes; the `safe` namespace (`src/safe.js`, `pipeline/pipeline.js` `safe`) and the new modules return `{ok: true, value}` or `{ok: false, error: {code, message, details?}}`. `validatePatch` never throws.
- Inputs are checked structurally (`src/input-check.js`); messages name the field and index, never the value. A malformed record fails the whole call instead of being skipped silently.
- CLI `main` always resolves `{ok: true, ...}` or an error result; the process prints errors as JSON on stderr, exit code 1, no stack trace, with `uncaughtException` / `unhandledRejection` handlers as a last resort. An invalid proposal from the adapter is `INVALID_PATCH` (baseline report and meta are still written, `patch.json` is not).
- Breaking change for callers of `main`: it no longer rejects; success results now carry `ok: true`.

### Still open
- The Gemini and Grok request shapes are still unverified against the live APIs (see above).
- `services/room/human-results.json` and per-card statistics ids are still assumptions (see above).

## Performance (measured 22:40, Node 22.22.3, darwin arm64, median of 5 runs, one thread)

| What | Size | Time | Throughput |
|---|---|---|---|
| `analyze` (15 matchups) | 3,000 matches | 3.4 ms | about 0.9 M matches/s |
| `analyze` | 30,000 matches | 20 ms | about 1.5 M matches/s |
| `analyze` | 180,000 matches | 148 ms | about 1.2 M matches/s |
| `analyzePhase` (seed pairing + analyze) | 30,000 / 180,000 | 74 ms / 532 ms | about 0.34-0.40 M matches/s |
| `buildMatchupTable` | 30,000 / 180,000 | 22 ms / 140 ms | about 1.3 M matches/s |
| `analyze` on `services/runner/recorded-match-results.json` | 200 matches | 0.2 ms | n/a |
| Engine, in-process single thread (`runMatch`, seeds 1-100, both seats) | 200 matches | 6.3 s | 32 matches/s |
| Before/after replay (two engine runs of one match) | 1 match | 80 ms | n/a |

- Analysis is not a bottleneck: even 180,000 matches finish in about half a second. The engine dominates (about 32 matches/s per thread here; the runner's recorded run reached 58 matches/s with 2 workers).
- A before/after JSON is small: about 2.3 KB for a 388-tick match (16 and 18 on-change timeline points).
- These numbers come from a throwaway benchmark run on this laptop with synthetic paired results (analysis rows) and the real engine (engine and replay rows). They are not demo results.
- Render fps is not measured here (no UI in this package).
- `package.json` asks for Node >= 24; this machine runs 22.22.3 and all tests pass on it.

## Polish 22:40

What I changed (no new features):
- All 80 existing tests passed at the start; nothing was skipped, weakened or deleted.
- Wrapped every line to 120 columns or less in `src/`, `pipeline/` and `test/` (about 100 lines), and moved a few long strings and ternaries into named locals. Checked that the wrap changed whitespace only, then re-ran the suite.
- `src/group.js` has one shared `isCountable(result)`: a match counts only when it is `valid` and not still `running`. A "valid" match that never finished used to count as a loss for the focal hero; it is now counted as invalid in the analyzer, pipeline, matchup table, human group, cards and replay. Test: `test/edge-cases.test.js`.
- `FakePatchAdapter` and `buildPrompt` now reject a malformed report with `INVALID_REPORT` instead of a `TypeError`.
- CLI: `--metrics` must hold a JSON object, and `verify` checks the shape of `report_baseline.json` before using it (clear `INVALID_INPUT` / `INVALID_REPORT`).
- Tidied imports in `src/human.js` (single block at the top), removed an unused test import and a stray test line.
- No `console` output outside the CLI's JSON result and error lines; no TODO/FIXME/debugger left.
- 4 new tests in `test/edge-cases.test.js`; the suite is now 84 tests, all passing.

Still blocked or open (needs someone else):
- Gemini and Grok request shapes are untested against the live APIs (no keys, no network allowed).
- `services/room/human-results.json` still does not exist; the format is my assumption.
- The Cards engine emits no per-card statistics, so `analyzeCards` returns nothing real yet.
- The recorded runner output still uses per-seat dataHash variants without `options.assignments`; the pipeline refuses it until the engine adopts addendum item 1. `replay` works on it through `resolveDataVariants`.
- `pipeline/arena-simulator.js` was written against the engine on `main`; it must be re-checked when the `engine` branch is merged.

## Pre-merge check

Checked against the `engine` branch (06860c2, sibling worktree `../balance-forge-engine`) and `web` (5861705), read-only.
This section supersedes the older "blocked" lines above about assignments, `human-results.json` and `arena-simulator.js`.

### What I ran
- `services/runner/recorded-roster-match-results.json` (300 matches, one dataHash, `options.assignments` on every match):
  `cli.js run` with the fake adapter goes through analyze, propose, validate and verdict. Exit 0, verdict `inconclusive`
  (20 games per matchup is below the n>=30 outlier rule and the 200-game verdict gate, so this is the honest answer).
- A real patched holdout: engine `applyPatch` (/moves/1/power -> 72) plus `rosterJobs` + `runBatch` (300 matches, new hash
  9fc13bd0). The pipeline paired it and returned `inconclusive` ("no outlier in the baseline report"). Roster of 5 gives 15 rows.
- Engine schema check with `validate()` from `packages/contracts`: 300/300 recorded MatchResults, my `report_baseline.json`
  (with human rows), `report_patched.json` and `patch.json` all pass.
- Patch validator vs engine `applyPatch`: 204 path/value combinations (bounds, bad index, bad path, float, negative):
  0 differences.
- Replay: re-simulating every 7th recorded roster match (43 matches, 10+ matchups) reproduces the runner `finalStateHash`,
  outcome and duration. New test: `test/replay.test.js`.
- `human-results.json` is a `MatchResult[]` (the room validates each with `validate('MatchResult')`), so `--human` accepts it
  as is. A synthetic file of 5 `human-*` results produced `humanMatches: 5` and a valid Report.

### Mismatches
| # | Where | Expected vs actual | Status |
|---|---|---|---|
| 1 | `pipeline/arena-simulator.js` bot call | Engine bot is `chooseActions(view, seq, variant)` -> `ActionInput[]` (move + attack), `seq = tick * 2`, `variant = seat index`; I called the old `chooseAction(view, tick, i)` | fixed-here |
| 2 | `loadArenaSimulator` | Returned a bare `ENGINE_UNAVAILABLE` for any failure | fixed-here: message names the missing file/export; `createArenaSimulator` throws `TypeError` naming each missing export; test asserts the real engine loads |
| 3 | `loadArenaSimulator` path | Imported only from this repo's `packages/games`; stale before the merge | fixed-here: optional engine root (`--engine-root`, tests use `test/engine.js`) |
| 4 | `pickLopsidedMatch` | Picked mirror `bari vs bari` (20/20 = first-seat advantage, not hero balance) for the before/after story | fixed-here: mirrors are skipped while any hero matchup exists |
| 5 | one dataHash per version | Addendum item 1 adopted by the engine | confirmed; tests now use the engine's `pairedJobs` (one hash) |
| 6 | Hash format | 64 lowercase hex everywhere (`hash()` from contracts) | no mismatch |
| 7 | Units | `elapsedMs` ms (I round it, engine metrics are floats), `durationTicks` ticks, rates 0..1, CI rounded to 6 decimals | no mismatch |
| 8 | `playtest.progress` | Engine: `{runId, gameId, dataHash, matchesDone, totalMatches, elapsedMs, matchups:[{matchup, heroes, wins:{hero:n}, games, draws, invalidMatches}]}`. Web `subscribeProgress` needs `{done, total, rows:[{dimension, wins, games}]}`, so it never fires on the real payload | CHANGE_REQUEST-web (analysis does not produce this message). Note `matchup` equals my report `dimension`, and `heroes[0]` is my focal side |
| 9 | `POST /v1/playtest/run` | Web sends `{gameId, matches}` and expects `{baseline, patched, proposal, verdict}`. Engine takes `{gameId, pairs}` and returns `{resultsPath, elapsedMs, matchCount, dataHash, recorded}`; nothing runs the analysis pipeline | CHANGE_REQUEST-engine (glue) and CHANGE_REQUEST-web (`pairs`) |
| 10 | Patch `origin` | I write `fake`, `gemini`, `grok`, `fallback`; web accepts `gemini`, `fallback`, `manual` and shows anything else as `manual` | CHANGE_REQUEST-web (I will not relabel `fake` as `manual`) |
| 11 | Human rows in `Report.rows` | Mine are `human: <a> vs <b>`; web charts treat every row as a bot matchup (`parseMatchup` makes "human: bari" a hero) | CHANGE_REQUEST-web |
| 12 | `before_after.json` | Mine has HP timelines only; web has no consumer and draws a mock replay (`replayGen.ts`). HP has no x/y, so a real side-by-side needs frames | CHANGE_REQUEST-web (use timeline for the HP numbers) and CHANGE_REQUEST-engine (optional frames from `replayOnData`) |
| 13 | `recorded.ts` in web | Reads the old `recorded-match-results.json` (two hashes, no assignments) and hard-codes `ci95: [0,1]`, `outlier: false` | CHANGE_REQUEST-web |
| 14 | Hero Cards per-card stats | Engine statistics have `play` / `end_turn` only; `analyzeCards` needs `play:<cardId>` | CHANGE_REQUEST-engine (optional) |
| 15 | Web `MatchConfig` type | Lacks optional `options.assignments` | CHANGE_REQUEST-web (type only) |

Open: Gemini/Grok request shapes are still unverified against live APIs; Node >=24 in root `package.json` vs 22.22.3 here.

## Polish 23:54

Second polish pass after the pre-merge check. Everything was already clean, so no code changed:
- 87 of 87 tests pass, none skipped; no test was weakened or removed.
- No line over 120 characters in `src/`, `pipeline/` or `test/`; no TODO, FIXME or debugger; the only console output is the
  CLI's one JSON result or error line.
- `check:secrets` passes; the working tree was clean before this note.
- Performance numbers above are unchanged (analysis code was not touched since they were measured).

Still blocked (needs others): see "Pre-merge check" and `CHANGE_REQUEST.md` (engine run endpoint glue, web progress and
origin mapping, per-card statistics); Gemini and Grok are unverified against live APIs.

## Round 6, step 1: `pipeline/full.js`

`runFull({ baselineResults, humanResults, baseData, adapter, runHoldout, holdoutSeeds, hashData, botPolicyVersion,
seedSetId, holdoutSeedSetId, elapsedMs, createdAt })` returns `{ ok: true, value }` (or an error result, never a throw).
`value` is the `POST /v1/playtest/full` body minus the transport fields (`runId`, `gameId`, `elapsedMs`; the server adds them):
`botPolicyVersion, seedSetId, holdoutSeedSetId, baseline, proposal{...patch, origin, changes[{path, label, old, new}]},
validation, patchedDataHash, patched, verdict, humanMatches`.
- `runHoldout(patchedData, seeds)` is injected (the server runs the engine there). `hashData` is injected too, so no clock,
  network or engine import lives in this file.
- Guards: holdout seeds must be non-empty integers and must not overlap the baseline seeds; the holdout results must use
  only the requested seeds and be pinned to the patched data hash (`DATA_HASH_MISMATCH` otherwise); a throwing
  `runHoldout` becomes `SIMULATION_FAILED`.
- Invalid patch: no holdout run; `validation.ok` is false, `patched` and `patchedDataHash` are `null`, verdict `inconclusive`
  with the reason. The shared interface does not say what to send here, so this is my choice; the server and web must
  handle `patched: null`.
- Verdict change: `judgePatch` returns `inconclusive` when seed sets differ. A holdout uses fresh seeds by design, so
  `judgePatch(..., { holdoutSeeds: true })` skips only that one check (all other gates stay). The default is unchanged and
  `full.js` is the only caller that sets it. The patched report carries `holdoutSeedSetId`.
- `changes[].label` reads the move id and its hero from `baseData` ("Bari · Spirit Arrow power"); `old` comes from `baseData`.
- Tests: `test/full.test.js` (fake adapter, stub `runHoldout`; accepted, rejected, human rows, invalid patch, 9 bad-input cases).

## Round 6, step 2: recorded roster report

`packages/analysis/recorded/recorded-roster-report.json` is a real `Report` made by `cli.js propose` from
`services/runner/recorded-roster-match-results.json` and its metrics (300 matches, 15 matchups, real Wilson 95% intervals,
`recorded: true`, `elapsedMs: 4319`, `createdAt` from the recorded metrics, bot policy `scripted-0.1.1`). The engine's
`validate('Report')` accepts it. `test/recorded.test.js` rebuilds it and fails if the file drifts.
- **Path:** the request named `services/runner/recorded-roster-report.json`, but that folder is not mine, so the file is in
  my folder. The integrator can copy it:
  `cp packages/analysis/recorded/recorded-roster-report.json services/runner/recorded-roster-report.json`.
- CLI change: `--metrics` now also reads `createdAt` (when the run was measured) instead of using the current time.
- At 20 games per matchup every row is below the n>=30 rule, so no row is an outlier; that is true for this sample, not a bug.

## Round 6 review

Read-only review of `services/room/playtests.js` `fullPlaytest` and the route in `server.js` (engine 3d52381). I also ran
`runFull` against the real engine runner (outside the server, same calls) with the fake adapter.

What is right: seeds are disjoint (baseline 1..pairs, holdout from 1000001); `hash` as `hashData` matches the stored version
hash (no `DATA_HASH_MISMATCH`); the adapter choice is `GEMINI_API_KEY` or fake; `humanResults` are copied; progress carries `phase`;
a second request gets `RATE_LIMITED`; `runningBatch` is cleared in `finally`.

Problems, most important first:
1. **The live path cannot reach accepted or rejected with the current data.** Non-roster `pairs: 50` gives one matchup,
   `bari vs real_armor`, 100 games, win rate 0.50, no outlier, so the verdict is `inconclusive` ("no target: no outlier in the
   baseline report"). `pairs: 100` (200 games) gives the same. The data is already balanced for the scripted bots, so there
   is nothing to fix. The demo story needs an unbalanced starting version (or recorded data) from the engine/integrator.
2. **Roster mode is `inconclusive` for thin data.** `roster: true, pairs: 50` gives 100 games per matchup; the verdict gate
   needs 200 per target, so every target says "only 100 games after patch (need 200)". It needs `pairs >= 100`, but see 3.
3. **Roster mode is slow.** `roster: true, pairs: 50` is 1,500 matches per phase and took about 63 s here (2 workers) for
   both phases; `pairs: 100` is about double. That is one HTTP request with no streaming of the response, so a client or proxy
   timeout is likely. Progress over `/ws` is the only sign of life.
4. **Mirror matchups become verdict targets.** In roster mode `bari vs bari` etc. are 100% (first-seat advantage), flagged as
   outliers, and become targets that a hero-power patch cannot fix, so `accepted` is unlikely. This is my verdict rule
   (`targets` = outlier rows). I did not change it tonight; suggested fix: leave mirror rows out of default targets, keep them
   in the "new extreme" check. Tell me if you want it.
5. **Errors lose their cause.** `if (!result.ok) throw Error(... 'INVALID_PATCH' ? 'PATCH_REJECTED' : 'TRANSPORT_UNAVAILABLE')`
   turns `NO_RESULTS`, `DATA_HASH_MISMATCH`, `SIMULATION_FAILED` and `INVALID_INPUT` into one generic code, and the
   `INVALID_PATCH` branch is dead (`runFull` returns a body with `validation.ok: false` instead). Pass `result.error.code`
   and message through (or log them) so a failure is diagnosable.
6. **Invalid patch response:** `patched` and `patchedDataHash` are `null`, and `seatWins.holdout` is `0` (number) while
   `seatWins.baseline` is an object. Make the holdout value `null` or the same shape.
7. **Minor:** `createdAt` is `new Date()` (fine as metadata, only not in simulation); the Gemini adapter falls back to the
   fake one on failure, and `proposal.origin` says `fallback`, which the web shows as `manual` for `fake` (already in
   `CHANGE_REQUEST.md`); the route reads `body.dataHash` only for `/run`, so `/full` always starts from the current version.

## Polish 01:05

Everything was already clean; only this report changed:
- 93 of 93 tests pass, none skipped, none changed. No line over 120 characters, no TODO/FIXME/debugger, no console output
  except the CLI's JSON line. `check:secrets` passes.
- Performance: `runFull` on 20,000 synthetic matches (10,000 per phase, injected holdout) takes 76 ms; analysis cost is
  negligible next to the engine. Real engine, `runFull` end to end with the fake adapter: `pairs: 50` non-roster (200
  matches) 5.1 s; `pairs: 100` (400 matches) 9.9 s; roster `pairs: 50` (3,000 matches) about 63 s.
- Round 6 review written above (7 findings; 1, 3 and 5 matter most for the demo).

Still blocked (needs others): the review findings above; web mapping of `fake`/`grok` origins; Gemini and Grok untested
against live APIs.

## Polish 01:55

Nothing changed since Polish 01:05, so everything is still clean: 93 of 93 tests pass (none skipped or edited), no line over
120 characters in code or tests, no TODO/FIXME/debugger, no console output except the CLI's JSON line, `check:secrets`
passes, and the working tree was clean. Performance numbers above are unchanged. Still blocked: the Round 6 review findings
(engine/integrator) and the live Gemini/Grok check.

## Polish 02:55

Still clean, no code changes since Polish 01:55: 93 of 93 tests pass (none skipped or edited), no line over 120 characters,
no TODO/FIXME/debugger, `check:secrets` passes, tree was clean. Performance numbers unchanged. Blocked on others: Round 6
review findings and the live Gemini/Grok check.

## Polish 03:55

Still clean, no code changes since Polish 02:55: 93 of 93 tests pass (none skipped or edited), no line over 120 characters,
no TODO/FIXME/debugger, `check:secrets` passes, tree was clean. Performance numbers unchanged. Blocked on others: Round 6
review findings and the live Gemini/Grok check.

## Polish 04:55

Still clean, no code changes since Polish 03:55: 93 of 93 tests pass (none skipped or edited), no line over 120 characters,
no TODO/FIXME/debugger, `check:secrets` passes, tree was clean. Performance numbers unchanged. Blocked on others: Round 6
review findings and the live Gemini/Grok check.

## Polish 05:55

Still clean, no code changes since Polish 04:55: 93 of 93 tests pass (none skipped or edited), no line over 120 characters,
no TODO/FIXME/debugger, `check:secrets` passes, tree was clean. Performance numbers unchanged. Blocked on others: Round 6
review findings and the live Gemini/Grok check.

## Polish 06:55

Still clean, no code changes since Polish 05:55: 93 of 93 tests pass (none skipped or edited), no line over 120 characters,
no TODO/FIXME/debugger, `check:secrets` passes, tree was clean. Performance numbers unchanged. Blocked on others: Round 6
review findings and the live Gemini/Grok check.

## Round 7 (early part, steps 1 and 2 only)

**1. Mirror rows and the verdict (`src/verdict.js`).** Default verdict targets are now the outlier rows that are not mirror
matchups (`a vs a`; they only show first-seat advantage, which a hero patch cannot fix). Mirror rows still count in the
"new extreme matchup" check (a patch that pushes a mirror row above 65% is still rejected), and explicit
`options.targets` may still name one. If the only outliers are mirrors the verdict is `inconclusive` with the reason "the
only outliers are mirror matchups (first-seat advantage)". 4 new tests in `test/verdict.test.js`.

**2. Measurement script, prepared and not run on new recordings.**
`node packages/analysis/pipeline/measure-full.js --mode nonroster --pairs 100 [--engine-root dir]` and
`--mode roster --pairs 100`. It runs `runFull` with the fake adapter against the real engine runner in-process (no server, no
network) and prints one JSON line: baseline and holdout rate for `bari vs real_armor` (win rate, games, CI, outlier flag), the
proposal with `origin`, validation, verdict, per-phase match counts and ms, and total elapsed. Seeds: baseline 1..pairs,
holdout 1000001.. (same as the room service). `test/measure.test.js` only checks the wiring on a 2-pair run; those numbers
are not a measurement. Expect roughly 10 s for non-roster and several minutes for roster at 100 pairs (earlier: roster 50
pairs was about 63 s).

**Bot seed derivation plug-in point.** `BOT_SEED_DERIVATIONS` at the top of `pipeline/arena-simulator.js` is the single place.
Each entry maps a bot policy version to `({ tick, seat, config }) => ({ seq, variant })`; today only `scripted-0.1.1`
(`seq = tick * 2`, `variant = seat`). When the engine exports the `scripted-0.2.1` derivation function, add one entry there
(a marked comment shows the shape). Until then `loadArenaSimulator` refuses a bot with another policy version
(`ENGINE_UNAVAILABLE`, naming the missing entry) rather than replaying with a wrong derivation. Consequence: when the engine
with 0.2.1 merges, `test/replay.test.js` and `test/measure.test.js` fail loudly until the entry is added. That is intended.
The derivation is also injectable (`createArenaSimulator({ botSeed })`), which a test covers.

Not done on purpose: regenerating the recorded report and the real `runFull` measurement (steps 2-3 of Round 7) wait for the
engine's 0.2.1 recordings.

## Round 7 (steps 2 and 3, after the 0.2.1 recordings)

Failing tests: 7 after the merge (stale replay seed derivation, stale recorded report, hard-coded counts), now **0 of 101**.

**Replay uses the engine's `deriveBotSeed`.** `BOT_SEED_DERIVATIONS['scripted-0.2.1']` in `pipeline/arena-simulator.js` is
`seq = tick * 2`, `variant = bot.deriveBotSeed(config.seed, seat)`, exactly as `services/runner/match.js` calls it. The entry
receives the engine's bot module, so the engine function is used, not a copy. Re-simulating every 67th of the 3,000 recorded
roster matches (45 matches, all matchups) reproduces the runner `finalStateHash`. Test changes (none weakened): the replay and
plug-in tests build the simulator with the engine policy's derivation; the roster hash test compares against the recorded
metrics `matchCount` (3,000, was a hard-coded 300) and samples about 45 matches; `recorded.test.js` reads the bot policy and
seed set from the recorded metrics instead of hard-coding 0.1.1.

**Recorded report.** Regenerated from the new recorded files with the CLI (`scripted-0.2.1`, 3,000 matches, 15 matchups, 200
games each). It is byte-identical to the copy the engine already put in `services/runner/recorded-roster-report.json`, so that
file is unchanged; `packages/analysis/recorded/recorded-roster-report.json` is now the same file (it was the stale 300-match
one). 14 of 15 rows are outliers (n=200 each); `bari vs real_armor` is 79.5%.

**Label fix found on the way.** `runFull` change labels looked up a hero through `characters[].moves`; the engine uses
`moveIds`, so the label was "Spirit Arrow power". Now "Bari · Spirit Arrow power" (test added).

### runFull against the real engine, fake adapter (`measure-full.js`, 2 workers, this laptop)
Proposal in both runs (origin `fake`): `/moves/1/power` 92 -> 72, "Spirit Arrow power", valid. Baseline seeds 1..100, holdout
seeds 1000001..1000100.

| Mode | Baseline Bari vs Real Armor | Holdout Bari vs Real Armor | Verdict | Time |
|---|---|---|---|---|
| non-roster, pairs 100 (200 + 200 matches) | 79.5% (n=200, CI 73.4-84.5%, outlier) | 76.0% (n=200, CI 69.6-81.4%, outlier) | **accepted** | 13.6 s (6.0 s + 7.5 s) |
| roster, pairs 100 (3,000 + 3,000 matches) | 79.5% (same row) | 76.0% | **rejected** | 243 s (118 s + 126 s) |

- **Non-roster accepted, but weakly.** The only gate that decides is "distance to 50% improves": 29.5 points to 26.0. The two
  confidence intervals overlap, so this is not evidence that the patch works; it is what the demo gate allows. Do not present
  it as a fix.
- **Roster is rejected by the "every target must improve" gate.** Default targets are all non-mirror outlier rows (13 of
  them). The patch changes one Bari move, so rows without Bari (`daewi vs nightcrow`, `daewi vs sepia`) move only by seed
  noise on the fresh holdout seeds, and any one of them not moving toward 50% rejects the patch: "daewi vs nightcrow:
  distance to 50% did not improve", "daewi vs sepia: ...". `accepted` is reachable in roster mode only if the patch (or a
  proposal tied to one hero) is judged on the rows it can affect. Options for you: judge only the rows that involve a hero
  whose move changed, or a pooled measure; I did not change the gate tonight.
- Mirror rows are no longer targets (step 1); they are not what blocks it.
- Engine speed with the 0.2.1 recording: 25 matches/s (3,000 matches in 119 s); earlier 0.1.1 runs reached 58 matches/s with
  fewer ticks per match.

## Round 7 (evidence blocks)

`src/evidence.js` `buildEvidence(countedResults, report)` (result-returning) adds an evidence block for each bot outlier row
(human rows get none), from the same counted matches the report used:
- both sides of the row (`focal` = alphabetically first hero, `other` = its opponent; `mirror: true` when they are the same hero);
- per action: `opportunities`, `uses`, `useRate` (`null` when there were no opportunities);
- per side: total `damage` and `damageShare` (side damage / both sides, `null` when no damage was dealt);
- `damage` per action is `null` and `missing: ["damageByAction", "hitsThroughGuard"]`: the engine statistics carry only
  `{actionId, opportunities, uses}` per action and one damage total per player. I did not estimate them. The exact fields
  to add are in `CHANGE_REQUEST.md` (engine item).

Where it shows up: `evidence.json` from the CLI (`propose` and `run`) and an `evidence` field in the `runFull` body (baseline
outliers only; `null` if it could not be built). It is additive; the web can ignore it. Real data check (recorded roster run,
`bari vs real_armor`, 200 games): Bari deals 69.9% of the damage; guard use rates are 35.2% (Bari) and 35.9% (Real Armor),
so guard use does not separate the sides in this data, and projectile use is 56.1% against 55.9%. These are use rates, not
proof of a cause. Tests: `test/evidence.test.js` (6 tests, hand-computed numbers).

## Round 8 versions

`pipeline/auto.js` exports `runAuto(input)` (final interface from Tony) and `baseVersionRecord(...)` (the root record,
`origin: "base"`). It never throws; failures come back as `stoppedBecause: "error"` with `error: { code, message }` and the
records made so far.

**Input:** `{ gameId, fromHash, data, rounds (1..5, default 3), requireApproval (default true), adapter, hashData,
applyPatch(data, proposal) -> { data, dataHash }, runBatch(dataHash, matchups, seeds) -> MatchResult[],
seedsFor(round, 'scan' | 'holdout'), allMatchups, botPolicyVersion, seedSetId, onProgress, onRecord, now }`.
`allMatchups` is a list of dimension strings such as `"bari vs daewi"` (the same strings as report rows).
**Output:** `{ records, stoppedBecause: 'fair'|'not_accepted'|'regression'|'rounds'|'awaiting_approval'|'error', error?,
finalCheck: Report | null, headHash }`.

**A round:** scan (round 1: `allMatchups`; later rounds: only the matchups the previous scan flagged) on the head version;
flagged = non-mirror outlier rows; `runFull` proposes, validates, applies the patch with the injected `applyPatch`, runs the
holdout on `seedsFor(round, 'holdout')` for the flagged matchups only (`runBatch(patchedHash, flagged, seeds)`), and judges it.
One version record per round: `{ dataHash, parentHash, gameId, createdAt, origin, changes[{path, label, old, new}], rationale,
target{matchup, before{rate, ci95, games}, after{...}} | null, verdict, approved, note? }`. `target` is the flagged matchup
furthest from 50%. When accepted and approved, the new hash is the next round's parent. `requireApproval` stops after the first
accepted record (`awaiting_approval`, `approved: false`, no final check); resuming is a new call with `fromHash`.

**Stops:**
- `fair`: the latest scan flags nothing.
- `not_accepted`: verdict is inconclusive or rejected (that record is kept, `approved: false`, the head does not move); an invalid
  patch (`invalidPatch`) or a patch that changes nothing (`noChange`, no record because it would be its own parent).
- `rounds`: the limit was reached while matchups were still flagged.
- `regression`: the final all-matchups check (same scan seeds as round 1, on the last accepted hash) shows a new extreme matchup
  (> 65%, n >= 200, not extreme on the same side in the first scan). The record of the last accepted version is then marked
  `rejected` (an extra `onRecord` call) and `headHash` goes back to its parent.
- `error`: any thrown or invalid thing; coded (`INVALID_INPUT`, `DATA_HASH_MISMATCH`, `SIMULATION_FAILED`, `INVALID_PATCH`).

**Limits worth knowing:**
- Regression is only seen at the end: rounds scan and hold out the flagged matchups, so a patch that wrecks an unflagged matchup
  is found by the final check, not in the round that caused it. With 2+ accepted rounds the check cannot say which round caused
  it, so the newest accepted record is marked, which can be unfair to it.
- `onProgress` totals are estimates (matchups x seeds x 2 seat orders), because `runBatch` has no progress callback.
- A round whose scan is already fair makes no holdout run; the final check is skipped only for `awaiting_approval` and `error`.

**Other changes:** `runFull` accepts an optional `applyPatch` (the engine's own) and then uses its `{ data, dataHash }`;
`newExtremeRows(before, after)` is now exported from `src/verdict.js` and used by both `judgePatch` and `runAuto`.
**Tests:** `test/auto.test.js` (10 tests, fake adapter and a stub runner with a win-rate model): clean run and parent chain,
scan scope and fresh seeds, approval, not accepted, no-change patch, regression, round limit, branching from a non-head
version, progress/record callbacks, bad input and failures.

## Round 8 review (preliminary, engine branch f476ec2, before the merge to main)

Read-only review of `services/room/auto.js`, `versions.js`, `storage.js` and the routes in `server.js`, against `runAuto` and
the record shape. I also ran `runAuto` once against the real engine runner in process (1 round, offline stand-in adapter).

Problems, most important first:
1. **A regression mark is not stored.** `VersionStore.add` returns the existing record when the hash is already stored, so the
   revised record that `runAuto` emits after a failed final check (verdict `rejected`, `approved: false`) is dropped. With
   `requireApproval: false` the stored record stays `approved: true`. Needs an update path (or `add` replacing a record with
   the same hash when only `verdict`, `approved` and `note` differ).
2. **`POST /v1/versions/:gameId/:hash/approve` approves anything.** It also approves `rejected` or `inconclusive` records and
   records whose parent is not approved. Suggest: only `verdict.verdict === 'accepted'` records can be approved.
3. **Progress rounds.** `onProgress` throws `INVALID_SCHEMA` outside rounds 1..rounds+1. My final check reported round 0, which
   would have ended every run as an error; fixed here (it is now round rounds+1) with a test. Keep that range check in sync.
4. **Manual `apply-patch` selects the new version globally** (`this.select(...)`), unlike the auto path. Intended? A manual
   patch changes the current version for every room.
5. **Cosmetic:** unknown version replies use `HASH_MISMATCH` with HTTP 404; `GET /v1/versions/:gameId/:hash` adds a `diff`
   field that equals `changes`.

What matches: seed plan (`autoSeeds`: scan 1..100, holdout 101..200, +200 per round) never overlaps and round 1 scan seeds equal
the final check seeds; `allMatchups` strings equal report dimensions; `recordVersion` re-checks old/new numbers against data;
`target.after` is never null on my side now.

**Real-engine finding that changed `runAuto`.** On the recorded roster data 14 of 15 rows are flagged, and one patch to one
move cannot make all of them improve: the first real run was `rejected` ("bari vs daewi ... did not improve", plus two rows
without Bari). `runAuto` now targets one hero per round (`focusTargets`: the hero in the most flagged matchups, ties
alphabetical); later scans still cover all flagged matchups, so `fair` is never claimed while something is flagged. 2 new tests.

**History script.** `pipeline/record-auto-history.js --out file.json [--rounds 3]` runs `runAuto` in process against the real
engine runner with an offline stand-in adapter (origin `fake`, lowers one move by 20%) and writes `[base, ...records]`. First run
(1 round, before the focus change): 3 min 17 s, one record, `rejected`. Not committed as data.

## Fair matchups stop early

`runFull` stops after the baseline when no bot row is an outlier (mirror rows do not count, as for verdict targets): the body
has `fair: true`, `proposal: null`, `validation: null`, `patched: null`, `patchedDataHash: null` and verdict
`inconclusive` with the reason "no outlier: the matchup is within the fair band". The adapter is never called (no LLM cost)
and no holdout run is made. A flagged matchup goes through as before and now says `fair: false`. Under 30 games there is no
outlier, so a thin sample is also reported as fair. `measureFull`'s tiny wiring test changed accordingly. Tests in
`test/full.test.js` (fair without adapter call, flagged still goes through, mirror-only, thin sample).

## Per-target verdict gate (Round 8 decision)

**In plain words (for the tutor).** A patch changes a few numbers, so it can fix some matchups and leave others alone. The old
rule asked every flagged matchup to improve, so one matchup that no Bari change could move (Bari beats Daewi 99% whatever
Spirit Arrow does) blocked a patch that had fixed the others. Now each flagged matchup ("target") gets its own outcome, and
the patch is judged on the whole picture:
- **improved:** with at least 200 games after the patch, the matchup is closer to 50% and either (a) the new 95% interval lies
  wholly on the 50% side of the old interval, or (b) the distance to 50% shrank by at least 5 points. Both are checks against
  noise, not against a single percentage.
- **worse:** the same test in the other direction (further from 50% by at least 5 points, or an interval wholly on the far side).
- **unchanged:** anything else, including fewer than 200 games.

**Accepted** needs at least one improved target, no worse target, no new extreme matchup (a side above 65% with 200 games) and no
rise in invalid matches. **Rejected** if any of those fail, or if enough games show that no target moved. **Inconclusive** when
nothing improved but some target had too few games. The verdict carries the evidence: `verdict.targets` is
`[{ matchup, before: {rate, ci95, games}, after: {rate, ci95, games}, outcome: 'improved'|'unchanged'|'worse' }]`, and `reasons`
has one line per target ("bari vs sepia: improved (88.0% [83.0%-92.0%] n=200 -> 70.0% [63.0%-76.0%] n=200)") so the screen
can show exactly which matchup the patch helped. `runFull` returns it in `verdict`, and `runAuto` stores the same array in each
version record's `verdict` (the engine's version schema accepts it). A fair stop and an invalid patch have no targets
(`verdict` without `targets` or with `[]`). The old per-target fields (`dimension`, `before`/`after` as plain numbers,
`ci95After`, `improved`) are gone. 8 new verdict tests (`test/verdict.test.js`).

**Offline stand-in direction (history script only).** For the focus hero of a round: if it is winning over the round's
matchups, its most-used attack (melee or projectile, counted from the matches it has seen) is lowered by 20%; if it is
losing, raised by 20%. Origin stays `fake`. Tests in `test/measure.test.js`.

## Diagnosis (Round 8)

`src/diagnose.js` (`buildDiagnosis`, `diagnosisMatchups`, `focusMatchupOf`). For a flagged matchup "A vs B" both heroes are
measured against every other hero (non-mirror; with 5 heroes the 3 + 3 other matchups plus the flagged one), from results
only; nothing is applied. Output `{ focusHero, matchup, heroes, classification, recommendations }`:
- `heroes[]`: `{ hero, overall {rate, ci95, games}, opponents [{ opponent, rate, ci95, games }], strength { role:
  'winner'|'loser', overallRate, marginPts, opponentsOutsideBand, worstOpponent } }`. Both sides are treated the same: the
  winner gets how much stronger than the rest and how many opponents it beats beyond the fair band (95% interval wholly above
  55%, at least 30 games), the loser the same below 45%. `worstOpponent` is where the hero is furthest from 50% in its role
  direction.
- `classification` (the flagged partner is left out of the counts, "most" means more than half of the other opponents):
  `overall_strong` (the winner is above the band against most) -> nerf the winner; `overall_weak` (the loser is below the band
  against most) -> buff the loser; both -> the larger gap decides; neither -> `counter_specific` (change the interaction).
- `recommendations[]` (ranked, one or two per hero): `{ hero, role, path, direction 'up'|'down', sizePct, why, expected, scope }`.
  The first one follows the classification (strong: the winner's nerf; weak: the loser's buff; counter: the winner's most-used
  attack in this matchup), then the other hero's. `sizePct` is 0.8 x the overall gap in points (0.5 x for an interaction),
  rounded to 5, within 5..30. The lever is chosen by use count (melee or projectile) from the use counts in the
  results, because damage per move is not recorded yet (engine request in `CHANGE_REQUEST.md`); `why` says so.
  Moves are shared (melee, projectile and guard each belong to several heroes), so levers are ranked: the hero's own unique
  attacks first (most used first), then its other unique moves, then shared attacks (most used first). A shared move carries
  `alsoAffects: [heroes it would also change]` and its `why` says it ranks below the hero's own moves; an own move has
  `alsoAffects: []`. At most two levers per hero. There is no global lever (`damageScalePermille` scales every hero, so it is not
  a way to change one hero's strength); that option was dropped. `expected` is a plain sentence ("brings 4 of 4 matchups toward the band"), an
  expectation not a measurement.
- Use: `runFull` accepts `runDiagnose(matchups, seeds)` and `diagnoseSeeds` (must not overlap baseline or holdout seeds), puts
  `diagnosis` in the body (`null` without `runDiagnose`, on a fair stop or if it cannot be built, then with `diagnosisError`)
  and gives it to the adapter as `context` (`proposeWithOrigin(report, { diagnosis })`); the LLM prompt carries aggregate numbers
  only. The patch still goes through validation and the holdout. `runAuto` diagnoses the most lopsided flagged matchup each
  round (reusing the scan where it covers the heroes, else running the missing matchups on the round's scan seeds as phase
  `diagnose`), targets the matchups of the hero it recommends, and returns `diagnoses: [{ round, diagnosis }]`. So "Bari beats
  Daewi, Daewi loses to everyone" becomes a Daewi buff. The offline stand-in follows the first recommendation. Tests:
  `test/diagnose.test.js` (each classification, lever, size, global, errors, prompt), `test/full.test.js`, `test/auto.test.js`.

Change labels in `runFull` follow the same ownership: a move only one hero owns reads "Bari · Spirit Arrow power"; a shared move
reads "Projectile power (shared: Daewi, Real Armor, Sepia)" instead of naming whichever hero happens to be listed first. 5 new
diagnose tests (shared-move ranking, own non-attack move first, hero with only shared moves, no global lever) and a label test.

## Hero stats in the allowlist (contract v0.1.2)

Step 1 of widening the levers: `/characters/N/health` (100..3000) and `/characters/N/speed` (30..400), integers, and within 40%
of the ROOT data value (integer test `10 x value` between `6 x` and `14 x` the root value). Accepted by the validator
(`validatePatch(..., { rootData })`; without `rootData` only the absolute bounds can be checked), the LLM response schema
(`PATH_PATTERN`, no leading zeros) and prompt (hero stat paths marked hero-only, plus each hero's original value and allowed
range when `rootData` is known), `applyPatchToData(..., { rootData })` for replay, `runFull` (`rootData`, default `baseData`)
and `runAuto` (`rootData`, default `data`; the engine passes the game's original data so later rounds cannot drift).
`test/patch-agreement.test.js` cross-checks the engine's `applyPatch(data, proposal, root)` against the validator on 400+
path/value combinations (bounds, leading zeros, bad indexes, relative bounds on the root and on a grown version, duplicates,
the 8-change limit): 0 differences. The engine copy of the path schema now refuses leading zeros too (`/moves/01/power`),
which the analysis validator always did; the normative spec pattern `[0-9]+` is looser, so this is a note for the spec.

## Hero stats as diagnosis levers

Step 2: health and speed are hero-only levers (`alsoAffects: []`). Lever order per hero, at most three: the hero's unique
attacks (most used first), then its stats (a weak hero: speed, then health; a strong hero: health, then speed), then other unique
moves, then shared attacks (marked `alsoAffects`). A stat is offered only if it can still move in the wanted direction: the
room is the nearer of the absolute bound and the 40% band around the root value (`rootData`, default `data`), under 5% of room
means not offered, and `sizePct` is capped by the room that is left (rounded down to 5). Data without `health` and `speed`
keeps the old behaviour. The offline stand-in applies a stat recommendation to the current value and clamps it to the 40%
band. 4 new diagnose tests and 1 stand-in test.

## Two candidates per round

Step 3 of widening the levers. A round now tries up to two candidates, the first two distinct recommendations of the focus
hero (`candidateDiagnoses`): the adapter is asked once per candidate with that recommendation first in the diagnosis context
(the stand-in and the prompt follow the first one). Each candidate is validated, applied with the injected `applyPatch` and
holdout-tested on the round's holdout seeds for the same target matchups (both candidates use the same fresh seeds, so they
compare like with like), and judged by the per-target gate. Both become version records with the same `parentHash`
(siblings), noted "candidate 1 of 2" and so on. The run continues from the accepted candidate; if both are accepted, the one
with the larger summed improvement (`improvement`: points closer to 50% over all targets) is approved and the other is
kept as "accepted, not chosen: the other candidate improved more". If neither is accepted the run stops `not_accepted` with
both records unapproved. With `requireApproval` both stay unapproved and the run waits. A candidate that repeats a version
(same hash as the other or as the parent), changes nothing or fails validation is skipped; the round only fails if no
candidate produced a result. Without a diagnosis there is one plain candidate, as before. The `seedsFor` interface is unchanged.
7 new tests in `test/auto.test.js` (siblings and parent, better of two, next round from the chosen record, neither accepted,
approval, skipped candidates, `candidateDiagnoses`).

## Three candidates and needs_designer

`MAX_CANDIDATES` is 3 (health is tried too). A hero no candidate could fix is not a reason to stop: the run records the hero in
`needs_designer` and works on the next hero in the next round. Result field (not a version record):
`needs_designer: [{ hero, tried: [{ label, path, old, new, outcome }], evidence }]` (also `round`, `matchups`, `rawEvidence` and, for a
skipped lever, `reason`). `outcome` is the verdict of that candidate (`rejected`, `inconclusive`) or `skipped` (invalid patch,
changes nothing, or a version that was already tried). `evidence` is one or two sentences with the numbers, for example
"daewi wins 10.0% overall (600 games, -40.0 points from 50%). 3 lever(s) tried (Daewi · Speed rejected, ...), none moved a flagged
matchup beyond noise. Worst matchup: daewi vs sepia at 10.0% (200 games), 10.0% after the last lever tried."
`pickFocus` takes flagged matchups from the most lopsided down, diagnoses each (cached per version) and picks the first whose
recommended hero is not escalated; without a diagnosis the open hero in the most flagged matchups. A version that was already
recorded is never tried again. The run stops only when nothing is flagged (`fair`), the rounds are used up (`rounds`), every
flagged hero is escalated (`needs_designer`, which replaces `not_accepted`; the value stays in the engine's allowed set), a
person must approve, the final check finds a regression, or on an error. Tests adapted for the new rules (3 candidates, the old
stop on a rejected verdict is now an escalation) plus 2 new: all levers rejected, and "the next hero is worked on" (Daewi cannot be
fixed, a later round fixes Bari).

## Why Daewi loses (replays)

`pipeline/matchup-forensics.js` (`forensics`, `summarize`, `forensicsSentence`; CLI `--heroes a,b --seeds 100 --engine-root dir`)
replays matches of one pair with the scripted bot (policy scripted-0.2.1) in this process and reads the real simulation: distance
over time (every 6th tick in `firstHeroLosses`), how often a melee swing is started out of range or in range, and how each swing
ends (landed, blocked by a guard, interrupted by a stun before it lands, whiffed). Daewi vs Real Armor, 100 seeds, both seat
orders (200 matches); Daewi wins 5 (2.5%):
- **Bot policy, not a number problem (first finding).** The 0.2.1 bot gives each seat a seeded stand-off distance of 1200 to 3600
  and stops closing in once inside it, but melee reaches only 1900. In 80 of 200 matches the two heroes never came within melee
  range at all (Daewi won 5 of those 80); where they did, Daewi won 0 of 120. In both bots most swings are thrown out of range: 71%
  of Daewi's (1,552 of 2,172) and 70% of Real Armor's (2,761 of 3,966) are started beyond 1900 and whiff.
- **When in range, the heavy melee loses the race.** Daewi's heavy melee takes about 9 ticks from start to hit (tier 2: 10-tick
  startup, 18 recovery, 40 cooldown); Real Armor's melee takes 3. Of Daewi's 620 in-range swings 39 landed (6%), 315 (51%) were
  interrupted by Real Armor's 3-tick jab (stun) before they landed and 266 (43%) hit a guard. Real Armor's 1,205 in-range swings
  landed 1,060 times (88%). Melee is available to Daewi in only 2.0% of in-range ticks (Real Armor 3.8%), because his own recovery
  and cooldown keep it busy.
- **Distance over time:** mean distance 7,600 at tick 0, 4,208 at 18, 2,546 at 30, about 1,900 from tick 42 on in the matches that
  close; in a typical never-close loss (seed 1) both heroes stop at about 3,090 apart and trade whiffed swings for 848 ticks.
- **So:** raising heavy_melee power or speed cannot help while the swing is interrupted or whiffs; what separates the heroes is
  startup time (10 vs 3 ticks), not power, and the bot's stand-off distance decides whether melee is ever possible. Startup
  ticks live in the weight tiers, which are not in the patch allowlist: this is for a designer (and the bot policy), exactly what
  `needs_designer` is for. `runAuto` takes an optional `explain({ hero, matchup })` and appends such a replay sentence
  ("Replays of daewi vs real_armor: In range, daewi's swings landed 6% (interrupted 51%, blocked 43%; 9.09 ticks from start to
  hit) against 88% for real_armor (2.97 ticks). 80 of 200 replays never came within melee range (1900); daewi started 71% of its
  swings out of range.") to the evidence; a failing `explain` is ignored. Tests: `test/forensics.test.js`, `test/auto.test.js`.

## Finding: balance depends on play style (bot policies side by side)

`pipeline/bot-compare.js` (`compareBots`; `--pairs 100 [--heroes a,b,c] [--engine-root dir]`) plays the roster in this process for
each policy and reports per matchup the first hero's win rate with a Wilson 95% interval, per hero the melee swings and the whiff
rate, and the share of ticks within melee range (1900). 100 pairs: 200 matches per matchup (mirrors: 100, first-seat wins),
13.7 minutes on one core. The Chairman kept scripted-0.2.1 for the demo and the final recorded run; 0.2.2 and 0.2.2b stay
documented, unadopted candidates (engine `bot-0.2.2.js`, `bot-0.2.2b.js`, BOT.md).

| | 0.2.1 (production) | 0.2.2 (own-reach stand-off, no out-of-range swings) | 0.2.2b (0.2.2, but projectile users still close in) |
|---|---|---|---|
| Ticks within melee range | 31.0% | 13.2% | 61.3% |
| Whiff rate, all heroes | 55-69% | 0% | 0% |
| bari vs daewi | 99.0 [96-100] | 100 [98-100] | 100 [98-100] |
| bari vs nightcrow / sepia | 88.0 [83-92] | 57.0 [50-64] | 98.5 [96-99] |
| bari vs real_armor | 79.5 [73-85] | 54.0 [47-61] | 90.0 [85-93] |
| daewi vs real_armor | 2.5 [1-6] | 0.0 [0-2] | 0.0 [0-2] |
| daewi vs nightcrow / sepia | 16.5 [12-22] | 0.0 [0-2] | 0.0 [0-2] |
| nightcrow vs real_armor | 30.5 [25-37] | 12.0 [8-17] | 12.5 [9-18] |
| nightcrow vs sepia | 31.5 [25-38] | 18.0 [13-24] | 46.0 [39-53] |
| real_armor vs sepia | 55.0 [48-62] | 36.0 [30-43] | 86.0 [81-90] |

Swings per hero over the roster: 0.2.1 10,000-22,000 (55-69% whiff, 57-70% started out of reach), 0.2.2 1,500-5,700, 0.2.2b
3,400-7,800 (0% whiff in both). Nightcrow and Sepia have identical stats in the data, hence identical rows.

What it shows: the same numbers (same data, same seeds) give a different game under a different play style. 0.2.2 removes every
wasted swing, but projectile heroes then never close in (0% of ticks within range for every pair without Daewi), the fights
become ranged duels, and the designed Bari flaw almost disappears (Bari vs Real Armor 79.5% -> 54.0%). 0.2.2b keeps melee in
every fight and makes the flaw worse (90.0%) and many more matchups lopsided. Daewi is at 0% against Nightcrow, Real Armor and
Sepia under both new policies: once his heavy melee is really in range it lands about 1,400-1,500 times but is interrupted
about 2,600-2,800 times (10-tick startup against 3-tick jabs). A balance verdict is therefore a verdict about a data version
played by one policy; the platform records `botPolicyVersion` with every report for exactly this reason.
Tests: `test/bot-compare.test.js`.

## Design intent (counter chart)

Heroes have intended counters (Bari is meant to beat Real Armor), so a matchup's target is the designer's intended rate, not always
50%. `src/intent.js`: an intent is `{ version, matchups: { "a vs b": { favored, strength } }, notes? }`; `strength` maps to the favored
side's target 50 / 55 / 60 / 65% (`even`, `slight`, `clear`, `strong`), the fair band is 5 points around it, no entry means even,
each pair appears once in either order (`normalizeIntent` gives canonical keys), mirrors have no intent.
- **Report rows** carry `target` and `deltaToTarget` (the first, alphabetical, hero's side), the outlier rule is "the whole 95%
  interval outside the target band, n >= 30", and the report records `intentVersion`. All of this only when an intent is given; without
  one nothing changes, and an all-even intent gives today's rows, outliers and verdicts exactly (tests strip the new fields and compare).
- **Verdict:** a target is judged "toward its target"; a new extreme is more than 15 points from the row's own target (65% for an even
  matchup, as before; exactly 15 is not more). Reason texts now say "toward/away from their target".
- **Diagnosis:** the hero ahead of its target in the flagged matchup is the winner to nerf; opponent rows carry the hero's own target
  and delta; "outside the band" is measured against the target; with an intent each hero also gets `overallOutsideBand` (a counter system
  is balanced overall, so a hero outside 45-55% overall is flagged even if every matchup is intended). `heroOverallRows` and the
  `heroOverall` field of the `runFull` body list every hero's overall rate.
- **Prompt and rounds:** rows carry their targets and the prompt says "toward their own targets, not toward 50%" only when some target
  is not 50%; `runFull` and `runAuto` take `intent`; the focus matchup is the one furthest from its target. Tests: `test/intent.test.js`.
