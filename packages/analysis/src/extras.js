// Optional Report fields from contract v0.1.1 addendum item 5. Validated, never invented:
// a field is present only when the caller supplies a measured/recorded value.
export function withExtras(report, extras = {}) {
  const out = { ...report };
  const { elapsedMs, recorded, createdAt, humanMatches } = extras;
  if (elapsedMs !== undefined) {
    if (!Number.isInteger(elapsedMs) || elapsedMs < 0) throw new RangeError('elapsedMs must be a non-negative integer');
    out.elapsedMs = elapsedMs;
  }
  if (recorded !== undefined) {
    if (typeof recorded !== 'boolean') throw new TypeError('recorded must be boolean');
    out.recorded = recorded;
  }
  if (createdAt !== undefined) {
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) throw new TypeError('createdAt must be an ISO string');
    out.createdAt = createdAt;
  }
  if (humanMatches !== undefined) {
    if (!Number.isInteger(humanMatches) || humanMatches < 0) throw new RangeError('humanMatches must be a non-negative integer');
    out.humanMatches = humanMatches;
  }
  return out;
}
