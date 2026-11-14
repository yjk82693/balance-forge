import { ApiError, failFrom, readJson, type PatchOrigin, type VerdictKind } from "./api";
import { describePath } from "../components/PatchCompare";
import { heroName } from "./heroes";
import type { Rate, ResultFacts } from "./resultCard";
import { VERDICT_COPY } from "./dashboardData";
import { originLabel } from "./fullRun";
import { fixturePatch } from "./fixtures";

/** One data version, as stored in services/room/data/versions/<gameId>.json (round 8 shared interface). */
export interface VersionRecord {
  dataHash: string;
  parentHash: string | null;
  gameId: string;
  createdAt: string;
  origin: PatchOrigin | "base";
  changes: { path: string; label?: string; old: number; new: number }[];
  rationale: string;
  target: { matchup: string; before: VersionRate; after: VersionRate } | null;
  verdict: { verdict: VerdictKind; reasons: string[] } | null;
  approved: boolean;
  note?: string;
}
export interface VersionRate {
  rate: number;
  ci95: [number, number];
  games: number;
}
/** The history plus which version rooms and runs use by default (`currentHash`, when the server says). */
export interface VersionList {
  versions: VersionRecord[];
  currentHash?: string;
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
export function parseVersionList(raw: unknown): VersionList | null {
  const list = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.versions) ? raw.versions : null;
  if (!list) return null;
  const versions = list.map(parseVersion).filter((v): v is VersionRecord => v !== null);
  const currentHash = isObject(raw) && typeof raw.currentHash === "string" ? raw.currentHash : undefined;
  return { versions, currentHash };
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
    outlier: t ? { ...asRate(t.matchup, t.before), isOutlier: true } : null,
    evidence: null,
    patch: v.changes.map((c) => ({
      field: c.label ?? describePath(c.path),
      old: c.old,
      next: c.new,
      rationale: v.rationale,
      origin: v.origin === "base" ? "base" : originLabel(v.origin),
      errors: [],
    })),
    holdout: t ? asRate(t.matchup, t.after) : null,
    verdict: v.verdict
      ? { kind: v.verdict.verdict, label: VERDICT_COPY[v.verdict.verdict].label, reasons: v.verdict.reasons }
      : null,
    others: null,
    othersNote: null,
  };
}

// ---- where the history comes from ----

// A stored history file, if the engine wrote one. A glob, so a missing file is simply absent.
const stored = import.meta.glob("../../../../services/room/data/versions/hero_arena.json", { import: "default" });

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
  return done === null ? null : fetchVersions(signal);
}
