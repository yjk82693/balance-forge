import type { MatchResult, PatchProposal, Report, ReportRow } from "./contract";
import { fixtureMatchConfig, fixturePatch } from "./fixtures";
import { heroName } from "./heroes";
import { mockTimeline } from "./replayGen";
import { mockReport } from "./mockReport";
import { mockCardsReport, mockCardsRun } from "./mockCards";
import { mockTentacleReport, mockTentacleRun } from "./mockTentacle";
import type { TentacleResult } from "./tentacleDash";
import { isProgressMsg, mockProgress, type ProgressMsg } from "./progress";
import { runFromFull } from "./fullRun";
import type { HpTimeline } from "./replaySource";
import { reportFromResults, type RunInfo } from "./reportFromResults";
import { createTransport } from "../mock/transport";
import { isMockMode } from "../mock/types";

/** The games the dashboard can run. */
export type RunGame = "hero_arena" | "hero_cards" | "tentacle_run";

export type PatchOrigin = "gemini" | "grok" | "fallback" | "fake" | "manual";
export type VerdictKind = "accepted" | "rejected" | "inconclusive";

export interface Change {
  path: string;
  label?: string;
  old?: number;
  new: number;
}

export interface Proposal {
  patch: PatchProposal;
  /** optional: field-level old -> new values; without it the UI shows the new values only */
  changes?: Change[];
  origin: PatchOrigin;
  /** why the model's answer was not used, when origin is "fallback" */
  fallbackReason?: string;
  validation: { ok: boolean; errors: string[] };
}

/** A win rate with its 95% interval and the games behind it, as the verdict carries it. */
export interface VerdictRate {
  rate: number;
  ci95: [number, number];
  games: number;
}
export type TargetOutcome = "improved" | "unchanged" | "worse";
/** One matchup the patch was meant to fix: how it stood before, after, and how that is judged. */
export interface VerdictTarget {
  matchup: string;
  before: VerdictRate;
  after: VerdictRate;
  outcome: TargetOutcome;
}

/** What the diagnosis found about one opponent of a hero. */
export interface OpponentRate extends VerdictRate {
  opponent: string;
}
export type Classification = "overall_strong" | "overall_weak" | "counter_specific";
/** How far one hero stands from even; the winner is the one above it, the loser the one below. */
export interface HeroStrength {
  role: "winner" | "loser";
  overallRate?: number;
  /** percentage points above (or below) 50% */
  marginPts?: number;
  /** how many opponents sit outside the fair band */
  opponentsOutsideBand?: number;
  worstOpponent?: string;
}
export interface HeroProfileData {
  hero: string;
  overall: VerdictRate | null;
  opponents: OpponentRate[];
  strength?: HeroStrength;
}
/** One suggested change, ranked: which hero, which field, which way and by how much, and why. */
export interface Recommendation {
  hero: string;
  role?: "winner" | "loser";
  path: string;
  direction: "up" | "down";
  sizePct: number;
  why: string;
  expected?: string;
  /** other heroes that share this move and change with it (melee, projectile and guard are shared) */
  alsoAffects?: string[];
}
/** The `diagnosis` of a /full body (request flag `diagnose: true`): a profile of each hero and what to change. */
export interface Diagnosis {
  focusHero?: string;
  heroes: HeroProfileData[];
  classification?: Classification;
  recommendations: Recommendation[];
}

/** One side of a card's split: the games where the deck's player played it (or held it and did not). */
export interface CardSide {
  wins: number;
  games: number;
  winRate: number | null;
  ci95: [number, number];
}

/** A card of one deck, from the baseline games of the focus matchup. dominant/weak compare the card with its deck. */
export interface CardRow {
  deck: string;
  cardId: string;
  plays: number;
  opportunities: number;
  playRate: number | null;
  played: CardSide;
  notPlayed: CardSide;
  deckWinRate: number | null;
  dominant: boolean;
  weak: boolean;
}

/** One card change (cost or power, one step) run on the same seeds as the unchanged data. */
export interface CardLever {
  path: string;
  cardId: string;
  field: "cost" | "power";
  from: number;
  to: number;
  rate: number;
  games: number;
  /** the first deck's win rate with the change minus without it, in points of 1.0 */
  effect: number;
  significant: boolean;
  towardTarget: boolean;
}

/** Hero Cards `diagnosis` (kind "cards"): the card table and the measured levers of the focus deck matchup. */
export interface CardDiagnosis {
  matchup: string;
  focalDeck: string;
  focalRate: number;
  target: number;
  direction: "up" | "down";
  probeBaseline: { rate: number; games: number; ci95: [number, number] };
  levers: CardLever[];
  probed: number;
  significantLevers: number;
  decks: { deck: string; wins: number; games: number; winRate: number | null }[];
  cards: CardRow[];
}

export interface Verdict {
  verdict: VerdictKind;
  reasons: string[];
  /** one row per target; absent while the analysis does not send them */
  targets?: VerdictTarget[];
}

/** What the dashboard needs from POST /v1/playtest/run. Only `baseline` is required. */
export interface PlaytestRun {
  baseline: Report;
  proposal?: Proposal;
  patched?: Report;
  verdict?: Verdict;
  /** hero profiles and recommendations, when the request asked to diagnose */
  diagnosis?: Diagnosis;
  /** Hero Cards: the card table and card levers (the run's diagnosis for that game) */
  cardDiagnosis?: CardDiagnosis;
  /** Sepia Tentacle Run: the wave table, the flagged wave and the per-wave verdict (instead of matchup rows) */
  tentacle?: TentacleResult;
  /** per-matchup evidence from the run body (`evidence`), when the server sent it */
  evidence?: RunEvidence;
  /** id of the run, when the server gave one */
  runId?: string;
  /** GET /v1/replay/:matchId for one finished bot match: the stored seed and accepted inputs, not views */
  replay?: ReplayInfo;
  /** the server said the matchup is fair (`fair: true`): no patch, no holdout, no verdict */
  fair?: boolean;
  /** client-side flag: data came from fixtures (?mock=1), not from a run */
  sample?: boolean;
}

/** Summary of GET /v1/replay/:matchId ({matchId, seed, config, frames, finalStateHash}). */
export interface ReplayInfo {
  matchId: string;
  seed?: number;
  frames?: number;
  finalStateHash?: string;
  /** from the analysis: HP over time for the baseline data and the patched data (see lib/replaySource.ts) */
  timeline?: HpTimeline;
}

/** One action of one side in the evidence; null numbers from the server are left out, never estimated. */
export interface EvidenceAction {
  actionId: string;
  opportunities?: number;
  uses?: number;
  /** 0..1 */
  useRate?: number;
}
export interface EvidenceSide {
  hero: string;
  damage?: number;
  /** 0..1 */
  damageShare?: number;
  actions: EvidenceAction[];
}
/** One matchup: `focal` is the side the matchup is about, `other` its opponent (packages/analysis evidence). */
export interface EvidenceRow {
  dimension: string;
  games?: number;
  focal: EvidenceSide;
  other: EvidenceSide;
}
export interface RunEvidence {
  rows: EvidenceRow[];
  /** field names the server could not measure; they are never shown */
  missing: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "server" | "shape",
    /** the server's error code, when it sent one (e.g. RATE_LIMITED) */
    readonly code?: string,
    /** a rejected matchup: do not fall back to a stored run or another matchup, show the error instead */
    readonly keepMatchup = false,
  ) {
    super(message);
  }
}

const isRow = (r: unknown): r is ReportRow => {
  const row = r as ReportRow;
  return (
    !!row &&
    typeof row.dimension === "string" &&
    Number.isFinite(row.wins) &&
    Number.isFinite(row.games) &&
    row.games >= 0 &&
    row.wins >= 0 &&
    row.wins <= row.games
  );
};

/** Drops rows with impossible counts (wins > games, NaN, negatives) so charts never draw nonsense. */
const cleanReport = (r: Report): Report => ({ ...r, rows: r.rows.filter(isRow) });

/**
 * Real mode: listen to the `playtest.progress` topic while a run is in flight.
 * Mock mode feeds progress from runPlaytest itself.
 */
export function subscribeProgress(onMsg: (p: ProgressMsg) => void): () => void {
  if (isMockMode()) return () => {};
  const t = createTransport("observer");
  const off = t.subscribe((env) => {
    if (env.type !== "playtest.progress") return;
    if (isProgressMsg(env.payload)) onMsg(env.payload);
  });
  return () => {
    off();
    t.close();
  };
}

export async function runPlaytest(
  matches = 1000,
  signal?: AbortSignal,
  onProgress?: (p: ProgressMsg) => void,
  heroes?: [string, string],
  diagnose = false,
  botPolicy?: string,
  gameId: RunGame = "hero_arena",
): Promise<PlaytestRun> {
  if (isMockMode() && gameId === "tentacle_run") {
    await playMockPhase(mockTentacleReport("broken"), "baseline", onProgress, signal);
    await playMockPhase(mockTentacleReport("patched"), "holdout", onProgress, signal);
    return mockTentacleRun();
  }
  if (isMockMode() && gameId === "hero_cards") {
    await playMockPhase(mockCardsReport("broken"), "baseline", onProgress, signal);
    await quietPhase(3000, signal); // the card probe sends no progress, like the real engine
    await playMockPhase(mockCardsReport("patched"), "holdout", onProgress, signal);
    return mockCardsRun();
  }
  if (isMockMode()) {
    // Baseline run, then the holdout run on the patched data, like the real /full endpoint.
    await playMockPhase(mockReport("broken"), "baseline", onProgress, signal);
    await playMockPhase(mockReport("patched"), "holdout", onProgress, signal);
    return {
      sample: true,
      baseline: mockReport("broken"),
      patched: mockReport("patched"),
      proposal: {
        patch: fixturePatch,
        origin: "fake",
        changes: [{ path: "/moves/1/power", label: "Bari · Spirit arrow power", old: 100, new: 72 }],
        validation: { ok: true, errors: [] },
      },
      verdict: { verdict: "accepted", reasons: ["sample verdict for the fixtures; not computed"] },
      // ?replay=timeline shows the HP-timeline replay path without a server
      replay: new URLSearchParams(location.search).get("replay") === "timeline"
        ? { matchId: "mock-match", timeline: mockTimeline(fixtureMatchConfig.seed, ["bari", "real_armor"]) }
        : undefined,
    };
  }
  if (gameId === "tentacle_run") {
    // Sepia Tentacle Run: solo runs of the scripted bot, one endpoint, no hero pair, no learned bots.
    const run = await runFullPlaytest(signal, undefined, false, undefined, gameId);
    if (!run) throw new ApiError("This server can't run Sepia Tentacle Run yet.", "server");
    return run;
  }
  if (gameId === "hero_cards") {
    // Hero Cards has one endpoint only: no plain-run fallback, no learned bots, the card probe is always part of it.
    const cards = await runFullPlaytest(signal, heroes, false, undefined, gameId);
    if (!cards) throw new ApiError("This server can't run Hero Cards yet.", "server");
    return cards;
  }
  const full = await runFullPlaytest(signal, heroes, diagnose, botPolicy);
  return full ?? runRealPlaytest(matches, signal, undefined, botPolicy);
}

/** Pairs per seat assignment for the live run: Bari vs Real Armor, 400 matches, over the 200-game verdict gate. */
export const FULL_RUN_PAIRS = 100;
/** Solo runs of Sepia Tentacle Run for the baseline (and the holdout): the plan's 200. */
export const TENTACLE_RUNS = 200;

/**
 * POST /v1/playtest/full {gameId, pairs}: baseline run (no roster: Bari vs Real Armor only, about 10 s), proposal,
 * validation, holdout run on the patched data and a verdict, in one request (progress streams over /ws meanwhile).
 * The all-matchups table is not part of this run; it comes from the recorded roster report. Returns null when the
 * server has no such endpoint (404/405), so the caller can fall back to the plain bot run.
 */
async function runFullPlaytest(
  signal?: AbortSignal,
  heroes?: [string, string],
  diagnose = false,
  botPolicy?: string,
  gameId: RunGame = "hero_arena",
): Promise<PlaytestRun | null> {
  let res: Response;
  try {
    res = await fetch("/v1/playtest/full", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        gameId === "tentacle_run"
          ? { gameId, runs: TENTACLE_RUNS, holdoutRuns: TENTACLE_RUNS }
          : {
              gameId,
              ...(heroes ? { heroes } : {}),
              ...(diagnose ? { diagnose: true } : {}),
              ...(botPolicy ? { botPolicy } : {}),
              pairs: FULL_RUN_PAIRS,
              holdoutPairs: FULL_RUN_PAIRS, // the holdout needs as many games as the baseline to pass the gate
            },
      ),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Couldn't reach the server.", "network");
  }
  if (res.status === 404 || res.status === 405) return null;
  // A server that rejects `heroes`, `diagnose` or `botPolicy` must not be answered with another run: show the error.
  if (res.status === 400 && (heroes || diagnose || botPolicy)) {
    const { code, text } = await readError(res);
    const what = [
      heroes ? heroes.map(heroName).join(" vs ") : "",
      diagnose ? "with diagnosis" : "",
      botPolicy ? `bots: ${botPolicy}` : "",
    ].filter(Boolean);
    const said = `${code ? `${code}: ` : ""}${text}`;
    throw new ApiError(`The server didn't accept this run (${what.join(", ")}). ${said}`, "server", code, true);
  }
  if (!res.ok) return failFrom(res);
  const run = runFromFull(await readJson<unknown>(res, "run reply"));
  if (!run) throw new ApiError("The server's reply had no report.", "shape");
  return run;
}

function quietPhase(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

function playMockPhase(
  report: Report,
  phase: "baseline" | "holdout",
  onProgress?: (p: ProgressMsg) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stop = mockProgress(
      report,
      (p) => {
        onProgress?.(p);
        if (p.matchesDone >= p.totalMatches) resolve();
      },
      { phase, steps: phase === "baseline" ? 40 : 20 },
    );
    signal?.addEventListener("abort", () => {
      stop();
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

const MESSAGES: Record<string, string> = {
  RATE_LIMITED: "Another run is already going.",
  INVALID_SCHEMA: "The server didn't accept the request.",
};

export async function readJson<T>(res: Response, what: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`The server's ${what} wasn't JSON.`, "shape");
  }
}

/** The server's error code and message from an error reply (a plain status line if it sent neither). */
async function readError(res: Response): Promise<{ code?: string; text: string }> {
  const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : undefined;
  const said = typeof body?.message === "string" ? body.message : undefined;
  return { code, text: said ?? MESSAGES[code ?? ""] ?? `The server answered ${res.status}.` };
}

/** Turns an error reply into an ApiError that carries the server's code and message, so the dashboard can show both. */
export async function failFrom(res: Response): Promise<never> {
  const { code, text } = await readError(res);
  throw new ApiError(code ? `${code}: ${text}` : text, "server", code);
}

/** Bot matches on one kept data version (POST /v1/playtest/run takes a dataHash). */
export const runBotsOnVersion = (dataHash: string, matches = 400, signal?: AbortSignal) =>
  runRealPlaytest(matches, signal, dataHash);

/** POST /v1/playtest/run, then GET the returned resultsPath and build the report from the match results. */
async function runRealPlaytest(
  matches: number,
  signal?: AbortSignal,
  dataHash?: string,
  botPolicy?: string,
): Promise<PlaytestRun> {
  const get = async (path: string, init?: RequestInit) => {
    try {
      return await fetch(path, { ...init, signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError("Couldn't reach the server.", "network");
    }
  };
  const res = await get("/v1/playtest/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId: "hero_arena",
      pairs: Math.max(1, Math.round(matches / 2)),
      ...(dataHash ? { dataHash } : {}),
      ...(botPolicy ? { botPolicy } : {}),
    }),
  });
  if (!res.ok) return failFrom(res);
  const info = await readJson<RunInfo>(res, "run reply");
  if (typeof info?.resultsPath !== "string") throw new ApiError("The server's reply had no results path.", "shape");
  const resultsRes = await get(info.resultsPath);
  if (!resultsRes.ok) return failFrom(resultsRes);
  const results = await readJson<MatchResult[]>(resultsRes, "results");
  if (!Array.isArray(results) || results.length === 0) throw new ApiError("The run returned no matches.", "shape");
  const replay = await fetchReplayInfo(results[0].matchId, signal);
  return { baseline: cleanReport(reportFromResults(results, info)), replay };
}

/** The stored replay of one match; absent (not an error) if the server has none or answers oddly. */
async function fetchReplayInfo(matchId: string, signal?: AbortSignal): Promise<ReplayInfo | undefined> {
  try {
    const res = await fetch(`/v1/replay/${encodeURIComponent(matchId)}`, { signal });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { seed?: unknown; frames?: unknown; finalStateHash?: unknown };
    if (!Number.isInteger(body.seed) || !Array.isArray(body.frames)) return undefined;
    return {
      matchId,
      seed: body.seed as number,
      frames: body.frames.length,
      finalStateHash: String(body.finalStateHash ?? ""),
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return undefined;
  }
}
