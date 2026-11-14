# Headless worker runner

```
node services/runner/cli.js --pairs 100 --workers 2 --out services/runner/recorded-match-results.json --metrics services/runner/recorded-metrics.json
node --test services/runner/*.test.js
```

Uses worker_threads. `pairedJobs({seeds, heroes, data})` produces each seed twice, reversing physical-seat hero assignments. `runBatch(jobs,{workers})` preserves job order regardless of worker scheduling. All MatchResults match fixtures/match_results.json, without extra wire keys. Invalid matches are explicitly marked valid:false and do not count as draws. A worker process failure rejects the batch and terminates remaining workers.

JSON results go to stdout unless --out is supplied; timing metadata goes to stderr and optionally --metrics. Timing includes worker startup, bot decisions, simulation, final hashes, result transfer and shape validation; excludes output-file serialization. Clock/timestamp measurements are runner metadata only, never simulation state.

recorded-match-results.json and recorded-metrics.json are actual measured runs, not the illustrative fixtures. The sample covers Bari versus Real Armor, seeds 1..100, both physical-seat assignments. It is a throughput sample, not evidence of human game balance. v0.1 stores hero selection in immutable game data: paired seat variants have different dataHash values. See packages/games/action/CHANGE_REQUEST.md; analysis must keep these variants explicit.
