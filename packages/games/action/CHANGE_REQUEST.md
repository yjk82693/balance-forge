# Optional v0.2 request: per-match character assignments

The v0.1 MatchConfig has no field for character/loadout assignments. The current compatible adapter stores the two physical-seat hero assignments in immutable GameData.gameRules.seats. Runner pairs use identical seeds and physical seat IDs, but reverse that immutable seat array; therefore the two seat configurations have distinct dataHash values. Each MatchResult faithfully pins its actual content hash. Analysis must retain the pairing metadata and must not pretend these are one dataHash group.

For a later contract revision, propose an optional, closed, game-schema-validated MatchConfig.options field containing per-player character assignments. This would allow one content hash for all roster matchups and seat-swapped pairs. Integrator review is required. No shared spec/fixtures were changed; v0.1 implementation continues using explicit immutable variants.
