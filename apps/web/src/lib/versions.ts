import {
  ApiError,
  failFrom,
  readJson,
  type PatchOrigin,
  type VerdictKind,
  type VerdictRate,
  type VerdictTarget,
} from "./api";
import { describePath } from "../components/PatchCompare";
import { heroName } from "./heroes";
import { needsMoreGames, type Rate, type ResultFacts } from "./resultCard";
import { VERDICT_COPY } from "./dashboardData";
import { originLabel, targetsFrom } from "./fullRun";
import { fixturePatch } from "./fixtures";
import { parseDesigner, saveDesigner, type DesignerCase } from "./designer";
import { isMockMode } from "../mock/types";

export type HistorySource = "live run" | "recorded" | "sample data";

/** One data version record (round 8 shared interface); the recorded history file holds a list of them. */
export interface VersionRecord {
  dataHash: string;
  parentHash: string | null;
  gameId: string;
  createdAt: string;
  origin: PatchOrigin | "base";
  changes: { path: string; label?: string; old: number; new: number }[];
  rationale: string;
  target: { matchup: string; before: VersionRate; after: VersionRate } | null;
  verdict: { verdict: VerdictKind; reasons: string[]; targets?: VerdictTarget[] } | null;
  approved: boolean;
  note?: string;
}
export type VersionRate = VerdictRate;
/** The history plus which version rooms and runs use by default (`currentHash`, when the server says). */
export interface VersionList {
  versions: VersionRecord[];
  currentHash?: string;
  /** heroes the auto-balance gave up on (`needs_designer`), when the server says */
  needsDesigner?: DesignerCase[];
  /** how a recorded auto-balance run went, from the stored file's `summary` */
  summary?: RunSummary;
}

/** The stored auto-balance run's `summary`: why it stopped and how many rounds it ran. */
export interface RunSummary {
  stoppedBecause?: string;
  rounds?: number;
  botPolicyVersion?: string;
  simVersion?: string;
  createdAt?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const isRate = (r: unknown): r is VersionRate =>
  isObject(r) && Number.isFinite(r.rate) && Array.isArray(r.ci95) && r.ci95.length === 2 && Number.isFinite(r.games);
const VERDICTS: string[] = ["accepted", "rejected", "inconclusive"];

/** A record from the wire; null when it lacks the fields a row needs (so one bad record never blanks the screen). */
export function parseVersion(raw: unknown): VersionRecord | null {
  if (!isObject(raw) || typeof raw.dataHash !== "string" || typeof raw.createdAt !== "string") return null;
  const target = isObject(raw.target) && isRate(raw.target.before) && isRate(raw.target.after)
    ? { matchup: String(raw.target.matchup ?? ""), before: raw.target.before, after: raw.target.after }
    : null;
  const verdict = isObject(raw.verdict) && VERDICTS.includes(String(raw.verdict.verdict))
    ? {
        verdict: raw.verdict.verdict as VerdictKind,
        reasons: Array.isArray(raw.verdict.reasons) ? raw.verdict.reasons.map(String) : [],
        targets: targetsFrom(raw.verdict.targets),
      }
    : null;
  return {
    dataHash: raw.dataHash,
    parentHash: typeof raw.parentHash === "string" ? raw.parentHash : null,
    gameId: String(raw.gameId ?? "hero_arena"),
    createdAt: raw.createdAt,
    origin: (["base", "gemini", "grok", "fallback", "fake", "manual"].includes(String(raw.origin))
      ? raw.origin
      : "manual") as VersionRecord["origin"],
    changes: Array.isArray(raw.changes)
      ? (raw.changes.filter((c) => isObject(c) && typeof c.path === "string") as VersionRecord["changes"])
      : [],
    rationale: String(raw.rationale ?? ""),
    target,
    verdict,
    approved: raw.approved !== false,
    note: typeof raw.note === "string" ? raw.note : undefined,
  };
}

/** The file or the endpoint: an array of records, or `{versions, currentHash}`. */
/** `summary` of the stored history file: the run's facts, and its `needs_designer` list kept apart. */
function parseSummary(raw: unknown): { run: RunSummary; needsDesigner: unknown } | undefined {
  if (!isObject(raw)) return undefined;
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const rounds = typeof raw.rounds === "number" && Number.isFinite(raw.rounds) ? raw.rounds : undefined;
  const run: RunSummary = {
    stoppedBecause: text(raw.stoppedBecause),
    rounds,
    botPolicyVersion: text(raw.botPolicyVersion),
    simVersion: text(raw.simVersion),
    createdAt: text(raw.createdAt),
  };
  return { run, needsDesigner: raw.needs_designer ?? raw.needsDesigner };
}

export function parseVersionList(raw: unknown): VersionList | null {
  const list = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.versions) ? raw.versions : null;
  if (!list) return null;
  const versions = list.map(parseVersion).filter((v): v is VersionRecord => v !== null);
  const currentHash = isObject(raw) && typeof raw.currentHash === "string" ? raw.currentHash : undefined;
  const summary = isObject(raw) ? parseSummary(raw.summary) : undefined;
  const given = isObject(raw) ? (raw.needs_designer ?? raw.needsDesigner ?? summary?.needsDesigner) : undefined;
  const cases = parseDesigner(given);
  return {
    versions,
    currentHash,
    ...(cases.length ? { needsDesigner: cases } : {}),
    ...(summary ? { summary: summary.run } : {}),
  };
}

/** "3 rounds · stopped because <reason>" for a recorded run; null when the file gave neither. */
export function summaryLine(s: RunSummary | undefined): string | null {
  const parts = [
    s?.rounds !== undefined ? `${s.rounds} round${s.rounds === 1 ? "" : "s"}` : "",
    s?.stoppedBecause ? `stopped because ${s.stoppedBecause.replace(/_/g, " ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export const shortHash = (hash: string) => hash.slice(0, 7);

export interface Row {
  record: VersionRecord;
  /** 0 for the main line; branches sit one step further in per sibling */
  lane: number;
}

/**
 * Newest first. A version's lane follows its parent's; when a parent has several children the first-born continues the
 * parent's lane and each later one gets the next lane in, so branches show as indented.
 */
export function layoutRows(records: VersionRecord[]): Row[] {
  const byHash = new Map(records.map((r) => [r.dataHash, r]));
  const lanes = new Map<string, number>();
  const oldestFirst = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const children = new Map<string, number>();
  for (const r of oldestFirst) {
    const parent = r.parentHash && byHash.has(r.parentHash) ? r.parentHash : null;
    const rank = parent ? (children.get(parent) ?? 0) : 0;
    if (parent) children.set(parent, rank + 1);
    lanes.set(r.dataHash, parent ? (lanes.get(parent) ?? 0) + rank : 0);
  }
  return [...oldestFirst].reverse().map((record) => ({ record, lane: lanes.get(record.dataHash) ?? 0 }));
}

/** A row on its own, or sibling versions that share a parent and are drawn side by side to compare them. */
export type Block = { kind: "row"; row: Row } | { kind: "siblings"; parent: string; rows: Row[] };

export function layoutBlocks(records: VersionRecord[]): Block[] {
  const rows = layoutRows(records);
  const known = new Set(records.map((r) => r.dataHash));
  const kids = new Map<string, Row[]>();
  for (const row of rows) {
    const p = row.record.parentHash;
    if (p && known.has(p)) kids.set(p, [...(kids.get(p) ?? []), row]);
  }
  const done = new Set<string>();
  const blocks: Block[] = [];
  for (const row of rows) {
    const p = row.record.parentHash;
    const group = p ? kids.get(p) : undefined;
    if (!p || !group || group.length < 2) blocks.push({ kind: "row", row });
    else if (!done.has(p)) {
      done.add(p);
      blocks.push({ kind: "siblings", parent: p, rows: group });
    }
  }
  return blocks;
}

/** How a sibling fared: the one kept, an accepted one that lost to it, or a rejected one. Null if none applies. */
export function branchChip(v: VersionRecord): { label: string; cls: string } | null {
  if (/not chosen/i.test(v.note ?? "")) return { label: "accepted, not chosen", cls: "warn" };
  if (v.verdict?.verdict === "rejected") return { label: "rejected", cls: "bad" };
  if (v.verdict?.verdict === "accepted") return { label: "chosen", cls: "ok" };
  return null;
}

export const fieldText = (c: VersionRecord["changes"][number]) =>
  `${c.label ?? describePath(c.path)} ${c.old} → ${c.new}`;

export const matchupName = (dimension: string) => dimension.split(" vs ").map(heroName).join(" vs ");

const asRate = (matchup: string, r: VersionRate): Rate => ({
  matchup: matchupName(matchup),
  rate: r.rate,
  lo: r.ci95[0],
  hi: r.ci95[1],
  games: r.games,
});

/** Facts for the Result card of one version: its own change list is the diff against its parent. */
export function factsFromVersion(v: VersionRecord, source: ResultFacts["source"]): ResultFacts {
  const t = v.target;
  return {
    source,
    sourceDetail: `${shortHash(v.dataHash)}${v.approved ? "" : " · candidate, not shipped"}`,
    fair: false,
    diagnosis: null,
    patchPaths: v.changes.map((c) => c.path),
    outlier: t ? { ...asRate(t.matchup, t.before), isOutlier: true } : null,
    evidence: null,
    patch: v.changes.map((c) => ({
      field: c.label ?? describePath(c.path),
      path: c.path,
      old: c.old,
      next: c.new,
      rationale: v.rationale,
      origin: v.origin === "base" ? "base" : originLabel(v.origin),
      errors: [],
    })),
    holdout: t ? asRate(t.matchup, t.after) : null,
    verdict: v.verdict
      ? {
          kind: v.verdict.verdict,
          label: VERDICT_COPY[v.verdict.verdict].label,
          reasons: v.verdict.reasons,
          targets: v.verdict.targets ?? [],
          needsMore: needsMoreGames(v.verdict.reasons) ?? undefined,
        }
      : null,
    others: null,
    othersNote: null,
  };
}

// ---- where the history comes from ----

// The recorded auto-balance run, { summary, versions }, committed with the runner (a missing file is just absent).
const stored = import.meta.glob("../../../../services/runner/recorded-auto-history.json", { import: "default" });

export async function loadRecordedVersions(): Promise<VersionList | null> {
  const load = Object.values(stored)[0];
  return load ? parseVersionList(await load()) : null;
}

/** ?mock=1: the base data plus the fixture patch (and a not-shipped candidate with no measurement). Sample only. */
export function sampleVersions(): VersionList {
  const rep = (rate: number, games: number): VersionRate => ({ rate, ci95: [rate - 0.1, rate + 0.1], games });
  const base: VersionRecord = {
    dataHash: "b".repeat(64), parentHash: null, gameId: "hero_arena", createdAt: "2026-11-14T08:00:00Z", origin: "base",
    changes: [], rationale: "The data the game ships with.", target: null, verdict: null, approved: true,
  };
  const patched: VersionRecord = {
    dataHash: "a".repeat(64), parentHash: base.dataHash, gameId: "hero_arena", createdAt: "2026-11-14T08:10:00Z",
    origin: "fake", changes: [{ path: "/moves/1/power", label: "Bari · Spirit arrow power", old: 100, new: 72 }],
    rationale: fixturePatch.rationale,
    target: { matchup: "bari vs real_armor", before: rep(0.79, 67), after: rep(0.54, 67) },
    verdict: { verdict: "accepted", reasons: ["sample verdict for the fixtures; not computed"] }, approved: true,
  };
  const candidate: VersionRecord = {
    ...patched,
    dataHash: "c".repeat(64),
    createdAt: "2026-11-14T08:20:00Z",
    origin: "manual",
    target: null,
    verdict: null,
    approved: false,
    note: "sample candidate, not measured",
  };
  return { versions: [base, patched, candidate], currentHash: patched.dataHash };
}

async function call<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Couldn't reach the server.", "network");
  }
  if (res.status === 404 || res.status === 405) return null; // this server has no such endpoint
  if (!res.ok) return failFrom(res);
  return readJson<T>(res, "reply");
}

const JSON_POST = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** GET /v1/versions/hero_arena: the history and the current hash; null when the server has no history endpoint. */
export async function fetchVersions(signal?: AbortSignal): Promise<VersionList | null> {
  const raw = await call<unknown>("/v1/versions/hero_arena", undefined, signal);
  return raw === null ? null : parseVersionList(raw);
}

/** A record with the changes that separate it from its parent. */
export interface VersionDetail {
  record: VersionRecord;
  diff: VersionRecord["changes"];
}

/** GET /v1/versions/hero_arena/:hash: the record plus its diff against the parent (`diff`, or `diff.changes`). */
export async function fetchVersion(hash: string, signal?: AbortSignal): Promise<VersionDetail | null> {
  const raw = await call<unknown>(`/v1/versions/hero_arena/${encodeURIComponent(hash)}`, undefined, signal);
  if (!isObject(raw)) return null;
  const record = parseVersion(isObject(raw.record) ? raw.record : raw);
  if (!record) return null;
  const nested = isObject(raw.diff) ? raw.diff.changes : null;
  const diff = Array.isArray(raw.diff) ? raw.diff : Array.isArray(nested) ? nested : null;
  const own = parseVersion({ ...record, changes: diff ?? record.changes });
  return { record, diff: own?.changes ?? record.changes };
}

/** POST /v1/versions/hero_arena/:hash/approve: ship a candidate version. The list is read again afterwards. */
export async function approveVersion(hash: string, signal?: AbortSignal): Promise<VersionList | null> {
  const path = `/v1/versions/hero_arena/${encodeURIComponent(hash)}/approve`;
  const done = await call<unknown>(path, JSON_POST({}), signal);
  return done === null ? null : fetchVersions(signal);
}

/** POST /v1/data/hero_arena/select { dataHash }: make a kept version current (the revert). Nothing is deleted. */
export async function makeCurrent(dataHash: string, signal?: AbortSignal): Promise<VersionList | null> {
  const done = await call<unknown>("/v1/data/hero_arena/select", JSON_POST({ dataHash }), signal);
  return done === null ? null : fetchVersions(signal);
}

/** The auto run's output file also has `needs_designer`: /v1/playtest/results/<runId>-auto.json ([] if unreadable). */
async function designerFromResults(runId: string, signal?: AbortSignal): Promise<DesignerCase[]> {
  try {
    const res = await fetch(`/v1/playtest/results/${encodeURIComponent(runId)}-auto.json`, { signal });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    return isObject(body) ? parseDesigner(body.needs_designer ?? body.needsDesigner) : [];
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return [];
  }
}

/**
 * POST /v1/playtest/auto { gameId, fromHash?, rounds, requireApproval }: rounds of measure, propose, validate, holdout.
 * `approval` is the screen's "Ask me before each version" toggle and goes out as `requireApproval`.
 * Progress (round and phase) streams over /ws; when it ends the list is read again.
 */
export async function runAutoBalance(
  opts: { rounds: number; approval: boolean; fromHash?: string },
  signal?: AbortSignal,
): Promise<VersionList | null> {
  const { rounds, approval, fromHash } = opts;
  const body = { gameId: "hero_arena", rounds, requireApproval: approval, ...(fromHash ? { fromHash } : {}) };
  const done = await call<unknown>("/v1/playtest/auto", JSON_POST(body), signal);
  if (done === null) return null;
  // The hand-overs ride on the auto result; the list is read again for the versions themselves.
  let cases = isObject(done) ? parseDesigner(done.needs_designer ?? done.needsDesigner) : [];
  const runId = isObject(done) && typeof done.runId === "string" ? done.runId : undefined;
  if (!cases.length && runId) cases = await designerFromResults(runId, signal);
  saveDesigner(cases);
  const list = await fetchVersions(signal);
  return list && cases.length ? { ...list, needsDesigner: cases } : list;
}

/** Where the history comes from: the server, else the stored file, else (?mock=1) the sample. */
export async function loadHistory(): Promise<{ list: VersionList | null; source: HistorySource }> {
  if (isMockMode()) return { list: sampleVersions(), source: "sample data" };
  try {
    const live = await fetchVersions();
    if (live) return { list: live, source: "live run" };
  } catch {
    /* no server: fall through to the stored history */
  }
  return { list: await loadRecordedVersions().catch(() => null), source: "recorded" };
}

