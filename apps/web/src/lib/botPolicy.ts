/**
 * Bot skill (round 9): the scripted bot is the default; a trained bot (self-play, cross-entropy method) and a
 * human-style bot (cloned from human matches) are extra lenses on the same balance question. The choice goes to the
 * server as `botPolicy` in /run and /full. Which of them exist is read from the files the trainer commits under
 * services/runner/learned/; with none, only the scripted bot is offered.
 */
import { parseHumanStyle, type HumanStyle } from "./humanStyle";

export type BotSkill = "scripted" | "trained" | "human";

export const BOT_SKILLS: { id: BotSkill; label: string; policy?: string }[] = [
  { id: "scripted", label: "Scripted" },
  { id: "trained", label: "Trained (self-play)", policy: "learned-cem-1" },
  { id: "human", label: "Human-style", policy: "cloned-lr-1" },
];

export const skillLabel = (id: BotSkill) => BOT_SKILLS.find((s) => s.id === id)?.label ?? id;

/** The `botPolicy` string to send for a skill; undefined for the scripted default (the server's own default). */
export const policyFor = (id: BotSkill): string | undefined => BOT_SKILLS.find((s) => s.id === id)?.policy;

// The trainer's output, committed under services/runner/learned/. A glob: absent files are simply absent.
const learnedFiles = import.meta.glob("../../../../services/runner/learned/*.json", { import: "default", eager: true });

const KEY = "bf-bot-skill";
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** One point of a fitness curve: a generation and the mean win rate of its population (0..1). */
export interface FitnessPoint {
  generation: number;
  meanWinRate: number;
}

/** What a trained hero's file says, read tolerantly (the shape is the trainer's; see lib/botPolicy.ts). */
export interface LearnedHero {
  hero: string;
  policy: string;
  curve: FitnessPoint[];
  generations?: number;
  seeds?: string;
  /** training time in seconds, when the file records it */
  trainingSeconds?: number;
  dataHash?: string;
  /** the opponents it trained against */
  trainedAgainst?: string[];
  /** the evaluation on seeds and an opponent that training never saw, when the file has one */
  heldOut?: HeldOut;
}

export interface HeldOutRate {
  rate: number;
  ci95: [number, number];
  games: number;
}
/** The learned bot, the same bot with its starting parameters and the scripted bot, on the held-out opponent. */
export interface HeldOut {
  opponent: string;
  learned: HeldOutRate;
  defaults?: HeldOutRate;
  scripted?: HeldOutRate;
}

function heldRate(raw: unknown): HeldOutRate | undefined {
  if (!isObject(raw) || !Array.isArray(raw.ci95) || raw.ci95.length !== 2) return undefined;
  const rate = Number(raw.winRate);
  const games = Number(raw.games);
  const ci: [number, number] = [Number(raw.ci95[0]), Number(raw.ci95[1])];
  return [rate, games, ...ci].every(Number.isFinite) ? { rate, ci95: ci, games } : undefined;
}

function parseHeldOut(raw: unknown): HeldOut | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!isObject(first) || typeof first.opponent !== "string") return undefined;
  const learned = heldRate(first.learned);
  if (!learned) return undefined;
  return { opponent: first.opponent, learned, defaults: heldRate(first.defaults), scripted: heldRate(first.scripted) };
}

/**
 * What the held-out numbers say about the learned bot, judged by the 95% intervals only: better than its own starting
 * parameters, worse, or no clear difference. Undefined when there is nothing to compare with.
 */
export function generalization(h: HeldOut): "better" | "worse" | "same" | undefined {
  if (!h.defaults) return undefined;
  if (h.learned.ci95[0] > h.defaults.ci95[1]) return "better";
  if (h.learned.ci95[1] < h.defaults.ci95[0]) return "worse";
  return "same";
}

function parseCurve(raw: unknown): FitnessPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p, i): FitnessPoint[] => {
    if (typeof p === "number" && Number.isFinite(p)) return [{ generation: i + 1, meanWinRate: p }];
    if (!isObject(p)) return [];
    const rate = [p.meanWinRate, p.mean_win_rate, p.mean, p.fitness, p.avg].find((v) => typeof v === "number");
    const gen = [p.generation, p.gen].find((v) => typeof v === "number");
    return typeof rate === "number" ? [{ generation: typeof gen === "number" ? gen : i + 1, meanWinRate: rate }] : [];
  });
}

function seedsText(v: unknown): string | undefined {
  if (typeof v === "number") return `${v} seeds`;
  if (Array.isArray(v)) {
    return v.length > 4 ? `${v.length} seeds (${v[0]}…${v[v.length - 1]})` : `seeds ${v.join(", ")}`;
  }
  return typeof v === "string" ? v : undefined;
}

/** `learned/<hero>.json` → `{ policy, params, trainedOn: {seeds, generations, dataHash}, fitness curve }`. */
export function parseLearned(hero: string, raw: unknown): LearnedHero | null {
  if (!isObject(raw)) return null;
  const trained = isObject(raw.trainedOn) ? raw.trainedOn : {};
  const curve = parseCurve(raw.fitness ?? raw.fitnessCurve ?? raw.curve ?? trained.fitness);
  const msList = [raw.trainingMs, trained.trainingMs, raw.elapsedMs];
  const ms = msList.find((v) => typeof v === "number") as number | undefined;
  const secs = [raw.trainingSeconds, trained.trainingSeconds].find((v) => typeof v === "number") as number | undefined;
  return {
    hero,
    policy: typeof raw.policy === "string" ? raw.policy : "learned",
    curve,
    generations: typeof trained.generations === "number" ? trained.generations : curve.length || undefined,
    seeds: seedsText(trained.seeds),
    trainingSeconds: secs ?? (ms !== undefined ? ms / 1000 : undefined),
    dataHash: typeof trained.dataHash === "string" ? trained.dataHash : undefined,
    trainedAgainst: Array.isArray(trained.opponents) ? trained.opponents.map(String) : undefined,
    heldOut: parseHeldOut(raw.heldOutEval),
  };
}

/** Every trained hero found in the committed files (the human-style model is not a hero). */
export function learnedHeroes(files: Record<string, unknown> = learnedFiles): LearnedHero[] {
  return Object.entries(files).flatMap(([path, raw]) => {
    const name = path.split("/").pop()?.replace(/\.json$/, "") ?? "";
    return name && name !== "human-style" ? parseLearned(name, raw) ?? [] : [];
  });
}

/** The human-style file, parsed, when it is in the committed files. */
export function humanStyle(files: Record<string, unknown> = learnedFiles): HumanStyle | null {
  const entry = Object.entries(files).find(([path]) => path.endsWith("/human-style.json"));
  return entry ? parseHumanStyle(entry[1]) : null;
}

/**
 * Which skills can be chosen: trained once at least one hero is trained, human-style only when its model file says it
 * is ready. Until then it is shown as exploratory (Skill screen) and never offered for a run.
 */
export function availableSkills(files: Record<string, unknown> = learnedFiles): BotSkill[] {
  const skills: BotSkill[] = ["scripted"];
  if (learnedHeroes(files).length > 0) skills.push("trained");
  if (humanStyle(files)?.ready) skills.push("human");
  return skills;
}

export function loadSkill(): BotSkill {
  try {
    const raw = sessionStorage.getItem(KEY);
    const known = BOT_SKILLS.some((s) => s.id === raw) && availableSkills().includes(raw as BotSkill);
    return known ? (raw as BotSkill) : "scripted";
  } catch {
    return "scripted";
  }
}

export function saveSkill(skill: BotSkill) {
  try {
    sessionStorage.setItem(KEY, skill);
  } catch {
    /* storage blocked: the choice lasts until the page is left */
  }
}
