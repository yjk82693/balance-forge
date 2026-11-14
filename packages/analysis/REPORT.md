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
