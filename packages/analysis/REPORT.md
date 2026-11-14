# packages/analysis report

Branch `ultron/analysis`. 80 `node:test` tests, all offline: `node --test packages/analysis/test/*.test.js`.
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
3. **Hero Cards statistics lack per-card ids.** The cards engine emits only `play` and `end_turn` actions. `analyzeCards` expects `play:<cardId>` actions (opportunities = card playable, uses = card played). Until the engine emits those, the analysis returns no cards. This is an engine-side change (`jokerstar/engine`); I did not touch it.
4. **Gemini and Grok request shapes are untested against the live APIs.** No keys, no network. Endpoints, header names, `responseSchema` / `json_schema` formats and the default model names (`gemini-2.5-flash`, `grok-4`; override with `GEMINI_MODEL` / `XAI_MODEL`) come from my memory of the public docs. Please do one live smoke run with real keys before the demo; a mismatch will show up as `origin: "fallback"` with a reason, not as a crash.
5. **Win rate semantics.** Row win rate = focal hero wins / valid paired games, draws count as games. The "recorded" badge needs `--metrics` with `kind: "recorded"`; nothing marks a report as recorded by default.
6. A fake-adapter proposal is a fixed `/moves/1/power -> 72` regardless of the report. It exists to keep the path working offline, not as analysis.

## Round 3 (high-end quality pass)

Order of work: H, N, J, K. Tests: `node --test packages/analysis/test/*.test.js` (80 pass, offline).

### H. Before/after replay (`src/replay.js`, `pipeline/arena-simulator.js`, CLI `replay`)
- `pickLopsidedMatch`: most lopsided matchup (largest distance from 50%), then the most one-sided win by its dominant side (damage margin, shorter, lower seed, matchId). Deterministic.
- `buildBeforeAfter`: re-simulates the same seed, seats and bot policy twice: on the unchanged data (must reproduce the recorded `finalStateHash`, else `REPLAY_MISMATCH`) and on the patched data (new dataHash). Output `before_after.json`: `{kind, seed, players, heroes, selection, patch, before, after, delta}`; each side has `outcome`, `durationTicks`, `finalStateHash`, `maxHp`, and an on-change `timeline: [{tick, hp: {p1, p2}}]` (first sample tick 0, last = final tick).
- The simulator is injected; `pipeline/arena-simulator.js` is the only engine-bound code. It mirrors `services/runner/match.js` and is loaded lazily from `packages/games/action` (read-only import). It was written against the engine on `main` (seat heroes in GameData). If `jokerstar/engine` changes the bot signature or the `initial/step/observe` API, only that file changes.
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
