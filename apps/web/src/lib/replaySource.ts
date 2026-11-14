import { useEffect, useState } from "react";
import type { PlaytestRun } from "./api";
import { isArenaPayload, type ArenaPayload, type GameEvent, type Observation } from "./contract";

/** One playable frame: an observation and the step events that came with it, if any. */
export interface ReplayFrame {
  observation: Observation<ArenaPayload>;
  events?: GameEvent[];
}

/** HP samples from the analysis (on change only; first sample is tick 0, last is the final tick). */
export interface TimelinePoint {
  tick: number;
  hp: Record<string, number>;
}

export interface HpTimeline {
  heroes: Record<string, string>;
  maxHp: Record<string, number>;
  broken: TimelinePoint[];
  patched: TimelinePoint[];
}

/**
 * Where the compare view gets its frames:
 * - views: real observations from GET /v1/replay/:matchId/views, per data version;
 * - timeline: the analysis' HP timeline (no positions were recorded, so heroes stand still);
 * - none: an illustrative replay, which the page labels as such.
 */
export type ReplaySource =
  | { kind: "views"; matchId: string; broken: ReplayFrame[]; patched: ReplayFrame[] }
  | { kind: "timeline"; matchId: string; frames: { broken: ReplayFrame[]; patched: ReplayFrame[] } };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** `[observation | {observation, events?}]` or `{views: [...]}`; anything unusable gives null. */
export function parseViews(json: unknown): ReplayFrame[] | null {
  const list = Array.isArray(json) ? json : isObject(json) && Array.isArray(json.views) ? json.views : null;
  if (!list || list.length === 0) return null;
  const frames: ReplayFrame[] = [];
  for (const item of list) {
    const obs = isObject(item) && "observation" in item ? item.observation : item;
    if (!isObject(obs) || !isArenaPayload(obs.payload)) return null;
    const events = isObject(item) && Array.isArray(item.events) ? (item.events as GameEvent[]) : undefined;
    frames.push({ observation: obs as unknown as Observation<ArenaPayload>, events });
  }
  return frames;
}

export function parseTimeline(raw: unknown): HpTimeline | null {
  if (!isObject(raw)) return null;
  const points = (v: unknown): TimelinePoint[] | null =>
    Array.isArray(v) && v.length > 0 && v.every((p) => isObject(p) && Number.isFinite(Number(p.tick)) && isObject(p.hp))
      ? (v as TimelinePoint[])
      : null;
  const src = isObject(raw.timeline) ? raw.timeline : raw;
  const broken = points(src.broken ?? src.before);
  const patched = points(src.patched ?? src.after);
  if (!broken || !patched || !isObject(raw.heroes)) return null;
  const maxHp = isObject(raw.maxHp) ? (raw.maxHp as Record<string, number>) : {};
  return { heroes: raw.heroes as Record<string, string>, maxHp, broken, patched };
}

const TICKS_PER_FRAME = 6; // 60 ticks/s, one frame per 100 ms: real time
const HOLD_FRAMES = 20;

/** Frames for the timeline: HP from the samples, positions fixed (they were not recorded). */
export function framesFromTimeline(points: TimelinePoint[], t: HpTimeline): ReplayFrame[] {
  const ids = Object.keys(t.heroes).sort();
  const last = points[points.length - 1].tick;
  const frames: ReplayFrame[] = [];
  for (let tick = 0; tick <= last + HOLD_FRAMES * TICKS_PER_FRAME; tick += TICKS_PER_FRAME) {
    const upTo = Math.min(tick, last);
    const sample = [...points].reverse().find((p) => p.tick <= upTo) ?? points[0];
    frames.push({
      observation: {
        tick,
        viewerId: "display",
        payload: {
          arena: { w: 16000, h: 9000 },
          entities: ids.map((id, i) => ({
            id,
            hero: t.heroes[id],
            x: i === 0 ? 4200 : 11800,
            y: 4500,
            hp: sample.hp[id] ?? 0,
            maxHp: t.maxHp[id],
            facing: i === 0 ? 0 : 180,
          })),
          projectiles: [],
        },
      },
    });
  }
  return frames;
}

async function fetchViews(matchId: string, dataHash: string, signal: AbortSignal): Promise<ReplayFrame[] | null> {
  try {
    const url = `/v1/replay/${encodeURIComponent(matchId)}/views?dataHash=${encodeURIComponent(dataHash)}`;
    const res = await fetch(url, { signal });
    return res.ok ? parseViews(await res.json()) : null;
  } catch {
    return null; // not there yet, or unreachable: the caller falls back
  }
}

/** Picks the best source for a run: real views, else the HP timeline, else null (illustrative replay). */
export async function resolveReplaySource(run: PlaytestRun, signal: AbortSignal): Promise<ReplaySource | null> {
  const replay = run.replay;
  if (!replay?.matchId) return null;
  const patchedHash = run.patched?.dataHash;
  if (patchedHash && run.baseline.dataHash) {
    const [broken, patched] = await Promise.all([
      fetchViews(replay.matchId, run.baseline.dataHash, signal),
      fetchViews(replay.matchId, patchedHash, signal),
    ]);
    if (broken && patched) return { kind: "views", matchId: replay.matchId, broken, patched };
  }
  const timeline = replay.timeline;
  if (timeline) {
    return {
      kind: "timeline",
      matchId: replay.matchId,
      frames: {
        broken: framesFromTimeline(timeline.broken, timeline),
        patched: framesFromTimeline(timeline.patched, timeline),
      },
    };
  }
  return null;
}

export function useReplaySource(run: PlaytestRun | null): ReplaySource | null {
  const [source, setSource] = useState<ReplaySource | null>(null);
  useEffect(() => {
    setSource(null);
    if (!run) return;
    const controller = new AbortController();
    resolveReplaySource(run, controller.signal).then((s) => !controller.signal.aborted && setSource(s));
    return () => controller.abort();
  }, [run]);
  return source;
}
