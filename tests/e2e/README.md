# Full-flow integration test

## test:e2e

From the repository root:

```sh
RUN_SOCKET_TESTS=1 node --test tests/e2e/full-flow.test.js
```

This is the test:e2e command. No root package.json is changed by this engine task. An integrator may expose the
same command as an npm script named test:e2e; until then, use the direct command above.

Without RUN_SOCKET_TESTS=1 the test is explicitly skipped, matching the existing room-test convention:

```sh
node --test tests/e2e/full-flow.test.js
```

Requirements: installed repository dependencies (ws), permission to listen on 127.0.0.1, and the merged analysis
pipeline under packages/analysis/pipeline with its replay/human helpers. Missing analysis modules cause an
explicit failure in opt-in mode; the test never replaces them with a mock. It never contacts an external host.

The test creates an ephemeral server on port 0 and three real ws clients: display, Bari phone and Real Armor
phone. Both phones use chooseActions, then it verifies the single recorded human result, a 20-pair worker run,
monotonic progress, /v1/playtest/full with both phase streams and disjoint seeds, fake-adapter proposal, immutable
patch, disjoint holdout, human-inclusive report and verdict,
archived-input replay on patched data through the analysis helper, and a second-match phone reconnect under 10 s.

The run endpoint selects seed prefixes. Baseline uses seeds 1..20 (40 matches); the patched request uses 1..40
(80 matches), but only untouched seeds 21..40 enter the holdout report. Default analysis gates are preserved:
small samples/different seed sets can legitimately produce inconclusive; the test does not require acceptance.
No real LLM adapter, API keys, acceptance-threshold overrides or synthetic analysis results are used.

All server data/results/replays, static fixtures and analysis artifacts are inside one mkdtemp directory.
Clients, server, workers and temporary files are cleaned up even on failure. Nothing writes to the repository's
human-results.json or other runtime files. The entire scenario has a 120 s timeout; individual waits are bounded.

Known environment limits and actual test results are recorded under Round 5 in services/room/REPORT.md.

Round 6 also requires packages/analysis/pipeline/full.js. The full-route call uses the offline adapter even if
the developer shell has a Gemini key, and checks response reports, changes, seat wins, and phase seed separation.
