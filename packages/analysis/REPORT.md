# packages/analysis report

Branch `ultron/analysis`. 47 `node:test` tests, all offline: `node --test packages/analysis/test/*.test.js`.
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
