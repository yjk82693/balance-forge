// Grouping and seed pairing (contract v0.1.1 addendum, item 1):
// one dataHash per content version; hero assignments live in config.options.assignments.

export function groupByDataHash(results) {
  const groups = new Map();
  for (const r of results) {
    const h = r.config.dataHash;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(r);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export const assignmentsOf = (result) => result.config.options?.assignments ?? null;

/** Hero-aware matchup: heroes sorted alphabetically, focal side = first hero. Null without assignments. */
export function heroMatchup(result) {
  const asg = assignmentsOf(result);
  if (!asg) return null;
  const seats = result.config.players;
  const heroes = seats.map((p) => ({ player: p, hero: asg[p] }));
  if (heroes.some((h) => typeof h.hero !== 'string')) return null;
  const sorted = [...heroes].sort((a, b) => (a.hero < b.hero ? -1 : a.hero > b.hero ? 1 : a.player < b.player ? -1 : 1));
  return { dimension: sorted.map((h) => h.hero).join(' vs '), focal: sorted[0].player };
}

export const hasAssignments = (results) => results.some((r) => heroMatchup(r) !== null);

/**
 * Pair by seed: a pair = same dataHash + seed + hero matchup, both valid, with seats swapped
 * (the focal hero sits in different seats). Anything else is unpaired.
 * @returns {{pairs: Array<{seed:number, dimension:string, results:object[]}>, unpaired: object[]}}
 */
export function pairBySeed(results) {
  const buckets = new Map();
  const unpaired = [];
  for (const r of results) {
    const m = r.valid ? heroMatchup(r) : null;
    if (!m) {
      if (r.valid) unpaired.push(r);
      continue;
    }
    const key = `${r.config.dataHash}|${r.config.seed}|${m.dimension}`;
    if (!buckets.has(key)) buckets.set(key, { seed: r.config.seed, dimension: m.dimension, items: [] });
    buckets.get(key).items.push({ r, focal: m.focal });
  }
  const pairs = [];
  for (const b of [...buckets.entries()].sort(([a], [c]) => (a < c ? -1 : 1)).map((e) => e[1])) {
    const seats = new Set(b.items.map((i) => i.focal));
    if (b.items.length === 2 && seats.size === 2) {
      pairs.push({ seed: b.seed, dimension: b.dimension, results: b.items.map((i) => i.r) });
    } else {
      unpaired.push(...b.items.map((i) => i.r));
    }
  }
  return { pairs, unpaired };
}
