# Agent rules for this repository

AI playtesting platform for multiplayer games, built during HackPrinceton Fall 2026 (Nov 13–15).

## Rules
- All code in this repo is written during the event. Do not import code written before Nov 13, 20:00.
- Follow `spec/contract-v0.1.md`. Test against `fixtures/`. Follow `docs/ui-tone.md` for anything visual.
- Simulation is deterministic: integer math, seeded PRNG (xorshift32-v1), stable ordering, no wall clock, no floats in state. Same inputs give the same state hash.
- One authoritative Node server. Clients and bots send the same ActionInput; only the server advances state.
- Never commit secrets. API keys come from environment variables; `.env` is git-ignored. Run `npm run check:secrets` before each commit.
- The LLM only proposes numeric patches as data (allowlisted paths, bounded values). It never writes code that runs.
- Only original game content. Do not copy GPL/AGPL or unclear-licence code or assets; record MIT/CC0 sources in THIRD_PARTY.md.
- Every number shown in the demo comes from an actual run. Pre-run results are labelled "recorded" with match count and time.
- Commit small and often with English messages and an area prefix (`core:`, `arena:`, `playtest:`, `ui:`). Never force-push or rewrite pushed history.
- Keep one working end-to-end path at all times; fix it before adding scope.

## Folder ownership (parallel work)
| Folder | Branch |
|---|---|
| `packages/contracts`, `packages/sim`, `packages/games`, `services/runner` | `engine` |
| `packages/analysis` | `analysis` |
| `apps/web` | `web` |
| `spec/`, `fixtures/`, `docs/`, `tools/`, root files | `main` (integration) |

Write only inside your own folder. Read everything else. If the spec must change, write it in `CHANGE_REQUEST.md` inside your folder and continue; the integrator decides. Do not add dependencies; if one is needed, stop and report. If blocked, stop and write the reason in `REPORT.md` in your folder.
