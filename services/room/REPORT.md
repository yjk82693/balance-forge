# Server implementation report

Commits are performed outside this sandbox. This task writes only owned engine/service files and runs node:test.

## Match assignments

Adopted the approved optional MatchConfig.options.assignments and optional report metadata from the addendum.
GameData no longer contains seats. Runner pairs reverse assignments, retain the same seed, and share one dataHash.
Arena action catalogs now expose separate move axes and attack aim parameters, with maxHp on entities.
Old v0.1 fixture shapes remain valid. Focused contracts/game/runner tests: 26 passed.

## Separate move action

Move accepts bounded moveX/moveY every tick unless stunned or eliminated, including during recovery and cooldown.
Movement consumes no cooldown and is excluded from attack uses/opportunities. Bots send movement plus a legal attack.
Frames and Authority allow at most one move and one attack per seat, with distinct monotonic sequences.
Tests cover movement through startup/recovery/cooldown, stun rejection, duplicate categories, receipts, and replay.
Full determinism matrix will run after the requested formatting pass, before server implementation.
