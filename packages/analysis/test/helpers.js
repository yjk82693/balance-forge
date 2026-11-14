import { readFileSync } from 'node:fs';
export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8'));

const HASH = (c) => c.repeat(64);
/**
 * Synthetic paired results shaped like fixtures/match_results.json, with addendum assignments.
 * heroes = [a, b]; each seed is run twice with seats swapped. winner(seed, swap) -> 'a' | 'b' | 'draw'.
 */
export function pairedResults({ dataHash = HASH('a'), heroes = ['bari', 'real_armor'], seeds = 100,
  winner = () => 'a', invalidSeeds = [] } = {}) {
  const base = fixture('match_results.json')[0];
  const out = [];
  for (let seed = 1; seed <= seeds; seed++) {
    for (let swap = 0; swap < 2; swap++) {
      const seatHeroes = swap ? [heroes[1], heroes[0]] : [heroes[0], heroes[1]];
      const w = winner(seed, swap);
      const mirror = heroes[0] === heroes[1]; // same hero both sides: 'a' = seat p1, 'b' = seat p2
      const winners = w === 'draw' ? [] : [mirror ? (w === 'a' ? 'p1' : 'p2') :
        ['p1', 'p2'][seatHeroes.indexOf(heroes[w === 'a' ? 0 : 1])]];
      const invalid = swap === 1 && invalidSeeds.includes(seed);
      out.push({
        ...structuredClone(base),
        matchId: `m-${out.length + 1}`,
        config: { ...base.config, dataHash, seed, options: { assignments: { p1: seatHeroes[0], p2: seatHeroes[1] } } },
        outcome: invalid ? { status: 'running', winners: [], reason: 'invalid_match' } : { status: winners.length ?
          'win' : 'draw', winners, reason: winners.length ? 'hp_zero' : 'max_ticks' },
        valid: !invalid,
        errorCode: invalid ? 'HASH_MISMATCH' : '',
      });
    }
  }
  return out;
}
