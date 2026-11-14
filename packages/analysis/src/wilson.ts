// Wilson score interval (95%). Analysis-side only; never used inside simulation state.
const Z95 = 1.96;

export function wilson95(wins, games) {
  if (!Number.isInteger(wins) || !Number.isInteger(games) || games < 0 || wins < 0 || wins > games) {
    throw new RangeError(`invalid wilson input: ${wins}/${games}`);
  }
  if (games === 0) return [0, 1];
  const p = wins / games;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / games;
  const center = (p + z2 / (2 * games)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games))) / denom;
  return [round6(Math.max(0, center - half)), round6(Math.min(1, center + half))];
}

export function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}
