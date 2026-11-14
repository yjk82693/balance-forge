// Wilson 95% interval for the trainer and the eval tool (the analysis module has the same formula; the runner keeps its
// own copy so it has no dependency on it).
const Z95 = 1.96;
export const round6 = x => Math.round(x * 1e6) / 1e6;

export function wilson95(wins, games) {
  if (!Number.isInteger(wins) || !Number.isInteger(games) || games < 0 || wins < 0 || wins > games) {
    throw RangeError(`invalid wilson input: ${wins}/${games}`);
  }
  if (games === 0) return [0, 1];
  const p = wins / games, z2 = Z95 * Z95, denominator = 1 + z2 / games;
  const center = (p + z2 / (2 * games)) / denominator;
  const half = Z95 * Math.sqrt(p * (1 - p) / games + z2 / (4 * games * games)) / denominator;
  return [round6(Math.max(0, center - half)), round6(Math.min(1, center + half))];
}
