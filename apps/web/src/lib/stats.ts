/** Wilson score interval for a binomial proportion (95% by default). Display math only; never enters sim state. */
export function wilson(wins: number, games: number, z = 1.96): [number, number] {
  if (games <= 0) return [0, 1];
  const p = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const center = (p + z2 / (2 * games)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export const pct = (x: number) => Math.round(x * 100);
