import { fail } from './errors.js';

// Optional Report fields from contract v0.1.1 addendum item 5. Validated, never invented:
// a field is present only when the caller supplies a measured/recorded value.
export function withExtras(report, extras = {}) {
  const out = { ...report };
  const { elapsedMs, recorded, createdAt, humanMatches } = extras;
  if (elapsedMs !== undefined) {
    if (!Number.isInteger(elapsedMs) || elapsedMs < 0) fail('INVALID_INPUT',
      'elapsedMs must be a non-negative integer');
    out.elapsedMs = elapsedMs;
  }
  if (recorded !== undefined) {
    if (typeof recorded !== 'boolean') fail('INVALID_INPUT', 'recorded must be boolean');
    out.recorded = recorded;
  }
  if (createdAt !== undefined) {
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) fail('INVALID_INPUT',
      'createdAt must be an ISO string');
    out.createdAt = createdAt;
  }
  if (humanMatches !== undefined) {
    if (!Number.isInteger(humanMatches) || humanMatches < 0) fail('INVALID_INPUT',
      'humanMatches must be a non-negative integer');
    out.humanMatches = humanMatches;
  }
  return out;
}

/** Rows computed from human matches carry this dimension prefix (UI: badge + border). */
export const HUMAN_PREFIX = 'human: ';
