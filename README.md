# balance-forge

**AI playtesting for game developers.** Bots play thousands of matches, the platform finds the balance problem, an LLM proposes a numeric patch, and the same seeds re-run to prove the fix. Players join from their phones by QR code, and every human match lands in the same report next to the bot data.

Built solo during **HackPrinceton Fall 2026** (Nov 13–15). The author made the design and integration decisions; AI coding assistants helped write and review code.

> Work in progress — this README is updated as the build lands.

## Layout
- `spec/` — shared game contract v0.1
- `fixtures/` — example data every package tests against
- `docs/ui-tone.md` — visual tone and design tokens
- `packages/`, `services/`, `apps/` — engine, bots, analysis, web
