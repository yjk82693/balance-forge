// The human-style bot (services/runner/learned/human-style.json): a model cloned from human matches. While its own
// readiness says it is not ready it is shown as exploratory, with the file's numbers and caveats, and never offered as
// the bot of a run.

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export interface HumanStyle {
  policy: string;
  /** readiness.ready: only then may runs use it */
  ready: boolean;
  matches: number | undefined;
  needed: number | undefined;
  matchesTrain: number | undefined;
  matchesTest: number | undefined;
  heldOutAccuracy: number | undefined;
  baselineAccuracy: number | undefined;
  baselineClass: string | undefined;
  cvAccuracy: number | undefined;
  cvBaseline: number | undefined;
  /** the file's own words on its readiness */
  note: string | undefined;
  /** the caveats as one paragraph (the file splits sentences across entries) */
  caveat: string | undefined;
}

/** The human-style file as the screen shows it; null when it is not a model file. A missing `ready` means not ready. */
export function parseHumanStyle(raw: unknown): HumanStyle | null {
  if (!isObject(raw) || typeof raw.policy !== "string") return null;
  const trained = isObject(raw.trainedOn) ? raw.trainedOn : {};
  const acc = isObject(raw.accuracy) ? raw.accuracy : {};
  const held = isObject(acc.heldOut) ? acc.heldOut : {};
  const cv = isObject(acc.crossValidation) ? acc.crossValidation : {};
  const ready = isObject(raw.readiness) ? raw.readiness : {};
  const caveats = Array.isArray(raw.caveats) ? raw.caveats.filter((c): c is string => typeof c === "string") : [];
  return {
    policy: raw.policy,
    ready: ready.ready === true,
    matches: num(ready.matches) ?? num(trained.matchesUsed),
    needed: num(ready.needed),
    matchesTrain: num(trained.matchesTrain),
    matchesTest: num(trained.matchesTest),
    heldOutAccuracy: num(held.accuracy),
    baselineAccuracy: num(held.baselineAccuracy),
    baselineClass: typeof held.baselineClass === "string" ? held.baselineClass : undefined,
    cvAccuracy: num(cv.accuracy),
    cvBaseline: num(cv.baselineAccuracy),
    note: typeof ready.note === "string" ? ready.note : undefined,
    caveat: caveats.length ? caveats.join(" ") : undefined,
  };
}

const pct1 = (x: number | undefined) => (x === undefined ? "—" : `${(x * 100).toFixed(1)}%`);

/** "Held out (3 matches): 21.0% against 23.4% for always playing none/still · cross-validation: 31.4% against 19.8%" */
export function humanStyleNumbers(h: HumanStyle): string[] {
  const lines: string[] = [];
  if (h.matches !== undefined) {
    const split = h.matchesTrain !== undefined && h.matchesTest !== undefined
      ? ` (${h.matchesTrain} to fit, ${h.matchesTest} held out)`
      : "";
    lines.push(`${h.matches} usable matches${h.needed !== undefined ? ` of the ${h.needed} asked for` : ""}${split}`);
  }
  if (h.heldOutAccuracy !== undefined) {
    const base = h.baselineClass ? `always playing ${h.baselineClass}` : "the baseline";
    lines.push(`Held-out accuracy ${pct1(h.heldOutAccuracy)} against ${pct1(h.baselineAccuracy)} for ${base}`);
  }
  if (h.cvAccuracy !== undefined) {
    lines.push(`Cross-validation ${pct1(h.cvAccuracy)} against ${pct1(h.cvBaseline)} for the baseline`);
  }
  return lines;
}
