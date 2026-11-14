# Optional v0.2 request: per-match character assignments

The v0.1 MatchConfig has no field for character/loadout assignments. The current compatible adapter stores the two
physical-seat hero assignments in immutable GameData.gameRules.seats. Runner pairs use identical seeds and physical
seat IDs, but reverse that immutable seat array; therefore the two seat configurations have distinct dataHash values.
Each MatchResult faithfully pins its actual content hash. Analysis must retain the pairing metadata and must not
pretend these are one dataHash group.

For a later contract revision, propose an optional, closed, game-schema-validated MatchConfig.options field containing
per-player character assignments. This would allow one content hash for all roster matchups and seat-swapped pairs.
Integrator review is required. No shared spec/fixtures were changed; v0.1 implementation continues using explicit
immutable variants.

## Approved assignments

The integrator approved MatchConfig.options.assignments in contract-v0.1.1-addendum.md.
Implemented: GameData no longer stores seat selections; paired assignments now share one content hash.

## Separate movement frames

The user's follow-up explicitly requires bots and humans to submit move plus an attack in one logical tick.
This narrows the v0.1 one-action-per-player limit: Hero Arena permits one move and one attack per seat per frame,
ordered by playerId then seq, with distinct monotonic sequence values. Duplicate moves or attacks are rejected.
Other games retain the original single-action rule. The integrator should document this transport clarification.
