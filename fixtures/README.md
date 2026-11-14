# Fixtures

Hand-written examples that follow `spec/contract-v0.1.md`. Every package tests against these so parallel work stays compatible. The numbers are **illustrative only**; never show them in the demo as results.

| File | Shape |
|---|---|
| `match_config.json` | MatchConfig |
| `match_results.json` | MatchResult[] (a win, a draw, an invalid match) |
| `report_baseline.json`, `report_patched.json` | Report before and after a patch |
| `patch_proposal.json` | PatchProposal |
| `observation.json` | Observation for the display |
| `ws_messages.json` | WebSocket envelopes: room.status, input.submit, input.ack, state.view, match.ended |
