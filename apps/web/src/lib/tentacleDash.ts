// The Sepia Tentacle Run analysis as the dashboard shows it: one row per wave (reached, cleared, clear rate with its
// interval, deaths), the flagged wave, the per-wave verdict targets and the patch in words. Read from the /full body of
// packages/games/tentacle/SPEC.md (example: packages/games/tentacle/example-full.json).

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export interface WaveRow {
  /** 1-based; 6 is the Man-Shark (kind "boss") */
  wave: number;
  reached: number;
  reachRate: number | null;
  cleared: number;
  /** cleared / reached; null when nobody reached it */
  clearRate: number | null;
  ci95: [number, number] | null;
  /** the clear rate the designer intends for this wave */
  target: number | null;
  deltaToTarget: number | null;
  deaths: number;
  /** the whole interval is below the target minus the margin: the wave the headline is about */
  outlier: boolean;
}

export interface FlaggedWave {
  wave: number;
  clearRate: number;
  ci95: [number, number] | null;
  target: number;
  deltaToTarget: number;
}

export interface WaveTarget {
  wave: number;
  before: { rate: number; ci95: [number, number] | null; games: number };
  after: { rate: number; ci95: [number, number] | null; games: number };
  outcome: WaveOutcome;
  /** the clear rates that count as on target for this wave (0..1), when the analysis says */
  band: [number, number] | null;
}

export type WaveOutcome = "improved" | "on target" | "overshot" | "unchanged" | "worse";
const OUTCOMES: WaveOutcome[] = ["improved", "on target", "overshot", "unchanged", "worse"];

/** The outcome in words; an overshoot is the patch making the wave too easy. */
export const outcomeWords = (o: WaveOutcome): string => (o === "overshot" ? "overshot (too easy)" : o);

/** The look of an outcome: on target and improved are good, an overshoot is a warning, worse is bad. */
export const outcomeClass = (o: WaveOutcome): string => {
  if (o === "on target" || o === "improved") return "status ok";
  if (o === "overshot") return "status warn";
  return o === "worse" ? "status bad" : "badge";
};

/** "target 60–70%" for a band, or "target 65%" for a single target; null when neither is known. */
export function targetWords(band: [number, number] | null, target: number | null): string | null {
  const p = (x: number) => Math.round(x * 100);
  if (band) return `target ${p(band[0])}–${p(band[1])}%`;
  return target === null ? null : `target ${p(target)}%`;
}

/** What the dashboard shows of a /full body for tentacle_run (the wire shape: packages/games/tentacle/SPEC.md). */
export interface TentacleResult {
  runs: number;
  holdoutRuns: number | null;
  winRate: number | null;
  winCi95: [number, number] | null;
  meanTicks: number | null;
  waves: WaveRow[];
  patchedWaves: WaveRow[];
  flagged: FlaggedWave | null;
  targets: WaveTarget[];
  elapsedMs: number | null;
}

/** "Section 4"; the last is the Man-Shark chase. (The wire format still says `wave`; only the words changed.) */
export const waveName = (wave: number, sectionCount = 6) =>
  wave >= sectionCount ? "Man-Shark chase" : `Section ${wave}`;

const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && num(v[0]) !== undefined && num(v[1]) !== undefined
    ? [Number(v[0]), Number(v[1])]
    : null;

function rowFrom(raw: unknown): WaveRow | null {
  if (!isObject(raw)) return null;
  const wave = num(raw.wave);
  const reached = num(raw.reached);
  const cleared = num(raw.cleared);
  if (wave === undefined || reached === undefined || cleared === undefined) return null;
  return {
    wave,
    reached,
    reachRate: num(raw.reachRate) ?? null,
    cleared,
    clearRate: num(raw.clearRate) ?? (reached ? cleared / reached : null),
    ci95: pair(raw.ci95),
    target: num(raw.target) ?? null,
    deltaToTarget: num(raw.deltaToTarget) ?? null,
    deaths: num(raw.deaths) ?? Math.max(0, reached - cleared),
    outlier: raw.outlier === true,
  };
}

/** `waves` of a baseline or patched block, sorted by wave; bad rows are dropped. */
export function wavesFrom(block: unknown): WaveRow[] {
  const list = isObject(block) && Array.isArray(block.waves) ? block.waves : [];
  return list.flatMap((r) => rowFrom(r) ?? []).sort((a, b) => a.wave - b.wave);
}

function rateOf(raw: unknown) {
  if (!isObject(raw)) return null;
  const rate = num(raw.rate);
  const games = num(raw.games);
  return rate === undefined || games === undefined ? null : { rate, ci95: pair(raw.ci95), games };
}

function targetsFrom(raw: unknown): WaveTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    if (!isObject(t)) return [];
    const [before, after, wave] = [rateOf(t.before), rateOf(t.after), num(t.wave)];
    const outcome = OUTCOMES.find((o) => o === t.outcome) ?? null;
    if (!before || !after || wave === undefined || !outcome) return [];
    return [{ wave, before, after, outcome, band: pair(t.band) }];
  });
}

/** The tentacle part of a /full body; null when it has no wave table. */
export function tentacleResultFrom(body: unknown): TentacleResult | null {
  if (!isObject(body)) return null;
  const waves = wavesFrom(body.baseline);
  if (!waves.length) return null;
  const base = isObject(body.baseline) ? body.baseline : {};
  const f = isObject(body.flaggedWave) ? body.flaggedWave : null;
  const flagged =
    f && num(f.wave) !== undefined && num(f.clearRate) !== undefined && num(f.target) !== undefined
      ? {
          wave: Number(f.wave),
          clearRate: Number(f.clearRate),
          ci95: pair(f.ci95),
          target: Number(f.target),
          deltaToTarget: num(f.deltaToTarget) ?? Number(f.clearRate) - Number(f.target),
        }
      : null;
  const verdict = isObject(body.verdict) ? body.verdict : {};
  return {
    runs: num(body.runs) ?? num(base.validRuns) ?? waves[0].reached,
    holdoutRuns: num(body.holdoutRuns) ?? null,
    winRate: num(base.winRate) ?? null,
    winCi95: pair(base.winCi95),
    meanTicks: num(base.meanTicks) ?? null,
    waves,
    patchedWaves: wavesFrom(body.patched),
    flagged,
    targets: targetsFrom(verdict.targets),
    elapsedMs: num(body.elapsedMs) ?? null,
  };
}

const FIELD_WORDS: Record<string, string> = {
  length: "Length",
  pits: "Pits",
  lowBars: "Low bars",
  walls: "Walls",
  anchorSpacing: "Anchor spacing",
  runSpeed: "Run speed",
};

/** "Section 4 · Pits" for /gameRules/sections/3/pits (the paths count sections from 0); null for other paths. */
export function waveChangeLabel(path: string): string | null {
  const m = /^\/gameRules\/sections\/(\d+)\/([A-Za-z]+)$/.exec(path);
  return m ? `Section ${Number(m[1]) + 1} · ${FIELD_WORDS[m[2]] ?? m[2]}` : null;
}
