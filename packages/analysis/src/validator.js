// PatchProposal validator. Data only: allowlisted paths, bounded integers, max 8, pinned base hash.
export const MAX_REPLACEMENTS = 8;
const HASH_RE = /^[0-9a-f]{64}$/;
const MOVE_POWER_RE = /^\/moves\/(0|[1-9][0-9]*)\/power$/;
const DAMAGE_PATH = '/tuning/damageScalePermille';

/** Value bounds per allowed path (contract: power 0..10000, damageScalePermille 100..3000). */
export function boundsFor(path) {
  if (path === DAMAGE_PATH) return [100, 3000];
  if (MOVE_POWER_RE.test(path)) return [0, 10000];
  return null;
}

/**
 * @returns {{ok: boolean, errors: string[]}}
 * options.baseDataHash: the hash the server expects the proposal to be based on.
 * options.moveCount: if known, move indexes must be < moveCount.
 */
export function validatePatch(proposal, options = {}) {
  try {
    return validatePatchUnsafe(proposal, options ?? {});
  } catch {
    return { ok: false, errors: ['proposal could not be checked'] };
  }
}

function validatePatchUnsafe(proposal, options) {
  const errors = [];
  if (proposal === null || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return { ok: false, errors: ['proposal must be an object'] };
  }
  for (const k of Object.keys(proposal)) {
    if (!['baseDataHash', 'replacements', 'rationale'].includes(k)) errors.push(`unknown field: ${k}`);
  }
  if (typeof proposal.baseDataHash !== 'string' || !HASH_RE.test(proposal.baseDataHash)) {
    errors.push('baseDataHash must be 64 lowercase hex characters');
  } else if (options.baseDataHash !== undefined && proposal.baseDataHash !== options.baseDataHash) {
    errors.push('baseDataHash does not match current data');
  }
  if (typeof proposal.rationale !== 'string' || proposal.rationale.length > 2000) {
    errors.push('rationale must be a string of at most 2000 characters');
  }
  const reps = proposal.replacements;
  if (!Array.isArray(reps) || reps.length < 1) {
    errors.push('replacements must be a non-empty array');
  } else {
    if (reps.length > MAX_REPLACEMENTS) errors.push(`at most ${MAX_REPLACEMENTS} replacements`);
    const seen = new Set();
    reps.forEach((r, i) => {
      const at = `replacements[${i}]`;
      if (r === null || typeof r !== 'object' || Array.isArray(r)) return errors.push(`${at} must be an object`);
      for (const k of Object.keys(r)) if (k !== 'path' && k !== 'value') errors.push(`${at}: unknown field ${k}`);
      const bounds = typeof r.path === 'string' ? boundsFor(r.path) : null;
      if (!bounds) return errors.push(`${at}: path not allowed`);
      if (seen.has(r.path)) errors.push(`${at}: duplicate path ${r.path}`);
      seen.add(r.path);
      if (!Number.isInteger(r.value)) return errors.push(`${at}: value must be an integer`);
      if (r.value < bounds[0] ||
        r.value > bounds[1]) errors.push(`${at}: value out of range ${bounds[0]}..${bounds[1]}`);
      const m = MOVE_POWER_RE.exec(r.path);
      if (m && options.moveCount !== undefined && Number(m[1]) >= options.moveCount) {
        errors.push(`${at}: move index out of range`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}
