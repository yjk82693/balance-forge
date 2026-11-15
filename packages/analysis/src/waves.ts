// Tentacle Run analysis: the per-wave table (reach rate, clear rate given reached with a Wilson interval, deaths), the
// flagged wave, and the per-wave verdict of a patch. Pure functions over MatchResults; nothing here simulates.
import { wilson95, round6 } from './wilson.ts';
import { isCountable } from './group.ts';
import { assertMatchResults } from './input-check.ts';

/** Target clear rate of each wave given it was reached: 70% falling gently to 50% for the Man-Shark boss. */
export const DEFAULT_WAVE_TARGETS = [0.7, 0.7, 0.65, 0.65, 0.6, 0.5];
export const WAVE_COUNT = 6; // five waves and the boss
export const WAVE_BAND = 0.1; // a wave is flagged when its whole interval sits below target - 10 points
export const MIN_REACHED = 30;
const usesOf = (result: any, id: string): number =>
  result.statistics.players[0]?.actions.find((a: any) => a.actionId === id)?.uses ?? 0;

export function waveTable(results: any[], { targets = DEFAULT_WAVE_TARGETS }: { targets?: number[] } = {}) {
  assertMatchResults(results);
  const valid = results.filter(isCountable);
  const rows = Array.from({ length: WAVE_COUNT }, (_, i) => ({ wave: i + 1, reached: 0, cleared: 0, deaths: 0 }));
  let wins = 0, ticks = 0;
  for (const r of valid) {
    let last = 0;
    for (const row of rows) {
      const reached = usesOf(r, `wave:${row.wave}:reached`), cleared = usesOf(r, `wave:${row.wave}:cleared`);
      row.reached += reached;
      row.cleared += cleared;
      if (reached) last = row.wave;
    }
    if (r.outcome.reason === 'death' && last) rows[last - 1].deaths++;
    if (r.outcome.status === 'win') wins++;
    ticks += r.statistics.durationTicks ?? 0;
  }
  const total = valid.length;
  return {
    validRuns: total, invalidRuns: results.length - total,
    winRate: total ? round6(wins / total) : 0, winCi95: wilson95(wins, total),
    meanTicks: total ? Math.round(ticks / total) : 0,
    waves: rows.map((row) => {
      const target = targets[row.wave - 1] ?? 0.5;
      const ci95 = wilson95(row.cleared, row.reached);
      const clearRate = row.reached ? round6(row.cleared / row.reached) : null;
      return { wave: row.wave, kind: row.wave === WAVE_COUNT ? 'boss' : 'wave', reached: row.reached,
        reachRate: total ? round6(row.reached / total) : 0, cleared: row.cleared, clearRate,
        ci95: row.reached ? ci95 : null, target, deltaToTarget: clearRate === null ? null : round6(clearRate - target),
        deaths: row.deaths, outlier: row.reached >= MIN_REACHED && ci95[1] < round6(target - WAVE_BAND) };
    }),
  };
}

/** The flagged wave furthest below its target, or null (the table is fair). */
export function flaggedWave(table: ReturnType<typeof waveTable>) {
  const flagged = table.waves.filter((w) => w.outlier)
    .sort((a, b) => a.deltaToTarget - b.deltaToTarget || a.wave - b.wave)[0];
  return flagged ? { wave: flagged.wave, clearRate: flagged.clearRate, ci95: flagged.ci95, target: flagged.target,
    deltaToTarget: flagged.deltaToTarget } : null;
}

/** A Report-shaped object (one row per wave: wins = cleared, games = reached) for the patch adapters. */
export function waveReport(table: ReturnType<typeof waveTable>, meta: any) {
  return { reportId: meta.reportId ?? 'r-waves', contractVersion: '0.1', schemaVersion: 1, gameId: 'tentacle_run',
    simVersion: meta.simVersion, dataHash: meta.dataHash, botPolicyVersion: meta.botPolicyVersion,
    seedSetId: meta.seedSetId, validMatches: table.validRuns, invalidMatches: table.invalidRuns, draws: 0,
    humanMatches: 0,
    rows: table.waves.map((w) => ({ dimension: `wave ${w.wave}`, wins: w.cleared, games: w.reached,
      winRate: w.clearRate ?? 0, ci95: w.ci95 ?? [0, 1], uses: 0, opportunities: 0, outlier: w.outlier,
      target: w.target,
      deltaToTarget: w.deltaToTarget ?? 0 })) };
}

const side = (w: any) => ({ rate: w.clearRate, ci95: w.ci95, games: w.reached });
/** The fair band around a target: target +- 5 points (the same band the arena intent uses). */
export const TARGET_BAND = 0.05;
export const bandOf = (target: number): [number, number] =>
  [round6(target - TARGET_BAND), round6(target + TARGET_BAND)];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * Where a wave's clear rate stands against its target band, from its interval: "on target" (the interval overlaps the
 * band), "overshot" (the whole interval above the band), or below it: "improved" (the whole interval above the
 * baseline's interval), "worse" (the whole interval below it) or "unchanged".
 */
export function waveOutcome(before: any, after: any): string {
  const [low, high] = bandOf(before.target);
  if (after.ci95[1] >= low && after.ci95[0] <= high) return 'on target';
  if (after.ci95[0] > high) return 'overshot';
  return after.ci95[0] > before.ci95[1] ? 'improved' : after.ci95[1] < before.ci95[0] ? 'worse' : 'unchanged';
}

/**
 * The verdict of a patch, judged against the target band of each wave. A flagged wave of the baseline is "on target",
 * "improved" (moved toward the band but still below), "overshot" (the whole interval above the band: not accepted, the
 * patch made the wave too easy and needs another round or the designer), "unchanged" or "worse". A wave that was not
 * flagged and leaves its band upward (it was not above it before) counts as worse, and so does one that fell below
 * its baseline interval. Accepted needs one flagged wave on target or improved and nothing overshot, worse or newly
 * flagged.
 */
export function judgeWaves(before: ReturnType<typeof waveTable>, after: ReturnType<typeof waveTable>,
  { minReached = MIN_REACHED }: { minReached?: number } = {}) {
  const reasons: string[] = [];
  const targets: any[] = [];
  let thin = false;
  for (const b of before.waves.filter((w) => w.outlier)) {
    const a = after.waves[b.wave - 1];
    if (a.reached < minReached) {
      reasons.push(`wave ${b.wave}: holdout reached it ${a.reached} times; ${minReached} needed`);
      thin = true;
      continue;
    }
    const outcome = waveOutcome(b, a);
    const [low, high] = bandOf(b.target);
    targets.push({ wave: b.wave, matchup: `wave ${b.wave}`, before: side(b), after: side(a), outcome,
      band: [low, high] });
    reasons.push(`wave ${b.wave}: ${outcome} (${pct(b.clearRate)} -> ${pct(a.clearRate)} cleared, `
      + `n=${b.reached} -> ${a.reached}; band ${pct(low)}-${pct(high)})`);
    if (outcome === 'overshot') reasons.push(`wave ${b.wave}: overshot its band, the patch made it too easy: needs `
      + 'another round or the designer');
  }
  const others = after.waves.filter((a) => {
    const b = before.waves[a.wave - 1];
    if (b.outlier || b.reached < minReached || a.reached < minReached) return false;
    const [, high] = bandOf(b.target);
    const leftUpward = a.ci95[0] > high && b.ci95[0] <= high; // it was not above its band before
    return leftUpward || a.ci95[1] < b.ci95[0];
  });
  const newlyFlagged = after.waves.filter((a) => a.outlier && !before.waves[a.wave - 1].outlier);
  for (const w of others) reasons.push(`wave ${w.wave}: left its band or got worse beyond noise`);
  for (const w of newlyFlagged) reasons.push(`wave ${w.wave}: newly flagged`);
  const good = targets.some((t) => t.outcome === 'on target' || t.outcome === 'improved');
  const bad = targets.some((t) => t.outcome === 'overshot' || t.outcome === 'worse') || others.length > 0 ||
    newlyFlagged.length > 0;
  const verdict = good && !bad ? 'accepted' : bad ? 'rejected' : 'inconclusive';
  if (verdict === 'accepted') {
    reasons.push(`${targets.filter((t) => t.outcome === 'on target' || t.outcome === 'improved').length} of `
      + `${targets.length} flagged wave(s) on target or improved; nothing overshot or got worse`);
  } else if (thin && !good) reasons.push('the holdout was too thin to judge');
  return { verdict, reasons, targets };
}
