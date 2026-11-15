// PatchProposal validator. Data only: allowlisted paths, bounded integers, max 8, pinned base hash.
// Contract v0.1.4 adds Hero Cards: /gameRules/cards/N/cost (1..3) and /gameRules/cards/N/power (1..10, not on a
// peek card). Contract v0.1.2 adds hero stats: /characters/N/health and /characters/N/speed, which must also
// stay within 40% of the ROOT data value (options.rootData). Without rootData only the absolute bounds can be
// checked.
export const MAX_REPLACEMENTS = 8;
const HASH_RE = /^[0-9a-f]{64}$/;
const MOVE_POWER_RE = /^\/moves\/(0|[1-9][0-9]*)\/power$/;
const HERO_STAT_RE = /^\/characters\/(0|[1-9][0-9]*)\/(health|speed)$/;
const CARD_RE = /^\/gameRules\/cards\/(0|[1-9][0-9]*)\/(cost|power)$/;
const CARD_BOUNDS = { cost: [1, 3], power: [1, 10] }; // contract v0.1.4: Hero Cards cost and power
const WAVE_RE = /^\/gameRules\/sections\/([0-5])\/(pits|lowBars|walls|anchorSpacing|runSpeed)$/;
// contract v0.1.5: Tentacle Run section numbers
const WAVE_BOUNDS = { pits: [0, 8], lowBars: [0, 8], walls: [0, 6],
  anchorSpacing: [1500, 10000], runSpeed: [15, 60] };
const DAMAGE_PATH = '/tuning/damageScalePermille';
const HERO_STAT_BOUNDS = { health: [100, 3000], speed: [30, 400] };

/** Integer test for "within 40% of the root value": 10 x value between 6 x and 14 x the root value. */
export const withinFortyPercent = (value, rootValue) => 10 * value >= 6 * rootValue && 10 * value <= 14 * rootValue;

/** Absolute value bounds per allowed path (power 0..10000, damageScalePermille 100..3000, health, speed). */
export function boundsFor(path) {
  if (path === DAMAGE_PATH) return [100, 3000];
  if (MOVE_POWER_RE.test(path)) return [0, 10000];
  const stat = HERO_STAT_RE.exec(path);
  if (stat) return HERO_STAT_BOUNDS[stat[2]];
  const card = CARD_RE.exec(path);
  if (card) return CARD_BOUNDS[card[2]];
  const wave = WAVE_RE.exec(path);
  if (wave) return WAVE_BOUNDS[wave[2]];
  return null;
}

/**
 * @returns {{ok: boolean, errors: string[]}}
 * options.baseDataHash: the hash the server expects the proposal to be based on.
 * options.moveCount: if known, move indexes must be < moveCount.
 * options.rootData: the original game data; hero stats must stay within 40% of its values.
 */
export function validatePatch(proposal, options: any = {}) {
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
      const card = CARD_RE.exec(r.path);
      const cards = options.rootData?.gameRules?.cards;
      if (card && cards) {
        const root = cards[Number(card[1])];
        if (!root) errors.push(`${at}: card index out of range`);
        else if (card[2] === 'power' && root.kind === 'peek') errors.push(`${at}: this card has no power to change`);
      }
      const stat = HERO_STAT_RE.exec(r.path);
      if (stat && options.rootData) {
        const rootValue = options.rootData.characters?.[Number(stat[1])]?.[stat[2]];
        if (!Number.isInteger(rootValue)) errors.push(`${at}: character index out of range`);
        else if (!withinFortyPercent(r.value, rootValue)) {
          errors.push(`${at}: value must stay within 40% of ${rootValue}`);
        }
      }
    });
  }
  return { ok: errors.length === 0, errors };
}
