// Design intent: heroes have intended counters (Bari is meant to beat Real Armor), so the balance target of a
// matchup is the designer's intended rate, not always 50%. An intent is { version, matchups: { "a vs b": { favored,
// strength } }, notes? }. `strength` maps to the favored side's target rate; the fair band is +-5 points around the
// target. A matchup without an entry is even (50%). Changing the intent never changes a data hash; every report
// records the version.
import { fail } from './errors.js';
import { round6 } from './wilson.js';

export const STRENGTHS = Object.freeze(['even', 'slight', 'clear', 'strong']);
export const STRENGTH_TARGET = Object.freeze({ even: 0.5, slight: 0.55, clear: 0.6, strong: 0.65 });
export const INTENT_BAND = 0.05; // the fair band around a target

/** The canonical key of a pair: heroes in alphabetical order, as the report rows write it. */
export const pairKey = (a, b) => [a, b].sort().join(' vs ');

const parsePair = (key) => {
  const parts = String(key).split(' vs ');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1]) {
    fail('INVALID_INPUT', `intent matchup "${String(key).slice(0, 60)}" must be two different heroes: "a vs b"`);
  }
  return parts;
};

/**
 * Checks the shape and returns the intent with canonical keys (heroes sorted, each pair once whatever the order it
 * was written in). Does not know the roster: the room service checks that the heroes exist.
 */
export function normalizeIntent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('INVALID_INPUT', 'intent must be an object');
  if (typeof raw.version !== 'string' || !raw.version || raw.version.length > 64) {
    fail('INVALID_INPUT', 'intent.version must be a short string');
  }
  const source = raw.matchups ?? {};
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    fail('INVALID_INPUT', 'intent.matchups must be an object');
  }
  const matchups = {};
  for (const [key, entry] of Object.entries(source)) {
    const [a, b] = parsePair(key);
    const canonical = pairKey(a, b);
    if (Object.hasOwn(matchups, canonical)) fail('INVALID_INPUT', `intent lists the pair ${canonical} twice`);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('INVALID_INPUT', `${canonical}: bad entry`);
    }
    const { favored = null, strength } = entry;
    if (!STRENGTHS.includes(strength)) {
      fail('INVALID_INPUT', `${canonical}: strength must be one of ${STRENGTHS.join(', ')}`);
    }
    if (strength === 'even') {
      if (favored !== null) fail('INVALID_INPUT', `${canonical}: an even matchup has no favored hero`);
    } else if (favored !== a && favored !== b) {
      fail('INVALID_INPUT', `${canonical}: favored must be one of the two heroes`);
    }
    matchups[canonical] = { favored, strength };
  }
  const out = { version: raw.version, matchups };
  if (raw.notes !== undefined) {
    if (raw.notes === null || typeof raw.notes !== 'object' || Array.isArray(raw.notes) ||
        Object.values(raw.notes).some((n) => typeof n !== 'string' || n.length > 300)) {
      fail('INVALID_INPUT', 'intent.notes must map pairs to short strings');
    }
    out.notes = Object.fromEntries(Object.entries(raw.notes).map(([key, text]) => {
      const [a, b] = parsePair(key);
      return [pairKey(a, b), text];
    }));
  }
  return out;
}

/** The target win rate of the FIRST hero (alphabetical) of a report row dimension "a vs b". 0.5 without an entry. */
export function targetFor(dimension, intent) {
  const [a, b, ...rest] = String(dimension).split(' vs ');
  if (!intent || !b || rest.length || a === b) return 0.5;
  const entry = intent.matchups?.[pairKey(a, b)];
  if (!entry || entry.strength === 'even' || !entry.favored) return 0.5;
  const target = STRENGTH_TARGET[entry.strength];
  return round6(entry.favored === [a, b].sort()[0] ? target : 1 - target);
}

/** A hero's target rate against one opponent (from that hero's side). */
export function heroTarget(hero, opponent, intent) {
  const first = [hero, opponent].sort()[0];
  const t = targetFor(pairKey(hero, opponent), intent);
  return hero === first ? t : round6(1 - t);
}

/** Bounds of the fair band around a target. */
export const bandOf = (target) => [round6(target - INTENT_BAND), round6(target + INTENT_BAND)];
