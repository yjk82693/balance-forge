import type { ArenaPayload, GameEvent, Observation } from "./contract";

/** The room server steps at 60 Hz; the mock sends 6 ticks per 100 ms, which is the same rate. */
export const TICK_MS = 1000 / 60;
/** Draw this many ticks behind the newest snapshot (about 67 ms), so there is almost always one on each side. */
export const RENDER_DELAY_TICKS = 4;
/** When the buffer runs dry, guess at most this many ticks past the newest snapshot, then hold still. */
export const MAX_EXTRAPOLATE_TICKS = 2;
/** A tick that jumps back by more than this is a new match: start the buffer over. */
const RESET_BACK_TICKS = 60;
/** If the clock has fallen this far behind the newest snapshot, jump it forward instead of easing. */
const MAX_LAG_TICKS = 12;
const KEEP_TICKS = 120;

export interface Snapshot {
  tick: number;
  observation: Observation;
  events?: GameEvent[];
}

export interface BufferStats {
  /** snapshots newer than the render tick */
  depth: number;
  /** snapshots that arrived after the render clock had already passed their tick */
  late: number;
  /** frames drawn from a guess because no newer snapshot existed */
  extrapolated: number;
  renderDelayTicks: number;
}

/** Positions to draw this frame, by entity id and projectile id, in arena units. */
export interface Pose {
  entities: Map<string, { x: number; y: number }>;
  projectiles: Map<string, { x: number; y: number }>;
  extrapolating: boolean;
}

type Point = { x: number; y: number };
type Blend = (id: string, from: Point, kind: "entities" | "projectiles") => Point;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Snapshot interpolation for state.view. Packets are stored by tick; the render clock runs on the local clock at 60
 * ticks per second, a few ticks behind the newest one, and positions are linearly interpolated between the two
 * snapshots around the render tick. Time is passed in (`nowMs`), so frame rate does not matter.
 * Discrete things (HP, which projectiles exist, events) are not blended: they apply when the render tick reaches
 * the snapshot that carries them, via `due()`.
 */
export class SnapshotBuffer {
  private snaps: Snapshot[] = [];
  private delivered = -Infinity;
  private offset: number | null = null; // server tick = nowMs / TICK_MS + offset
  private lastRender = -Infinity;
  private spacing = 1; // smoothed ticks between snapshots
  readonly stats: BufferStats = { depth: 0, late: 0, extrapolated: 0, renderDelayTicks: RENDER_DELAY_TICKS };

  private get newest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  clear() {
    this.snaps = [];
    this.delivered = -Infinity;
    this.offset = null;
    this.lastRender = -Infinity;
  }

  push(snap: Snapshot, nowMs: number) {
    const newest = this.newest;
    if (newest && snap.tick < newest.tick - RESET_BACK_TICKS) this.clear(); // a new match
    if (this.snaps.some((s) => s.tick === snap.tick)) return; // duplicate
    if (snap.tick <= this.lastRender) this.stats.late += 1;
    const before = this.newest;
    this.snaps.push(snap);
    this.snaps.sort((a, b) => a.tick - b.tick);
    if (before && snap.tick > before.tick) this.spacing += (snap.tick - before.tick - this.spacing) * 0.1;
    this.stats.renderDelayTicks = Math.max(RENDER_DELAY_TICKS, Math.ceil(this.spacing) + 1);
    this.syncClock(snap.tick, nowMs);
    const cut = (this.newest?.tick ?? 0) - KEEP_TICKS;
    while (this.snaps.length > 2 && this.snaps[1].tick < cut && this.snaps[0].tick <= this.delivered) {
      this.snaps.shift(); // keep a little history, not the whole match
    }
  }

  /** The least-delayed packet shows the true clock: follow it quickly, drift back slowly if packets run late. */
  private syncClock(tick: number, nowMs: number) {
    const candidate = tick - nowMs / TICK_MS;
    if (this.offset === null) this.offset = candidate;
    else this.offset += (candidate - this.offset) * (candidate > this.offset ? 0.05 : 0.005);
  }

  /** The tick to draw at `nowMs`; never goes backwards, never more than a couple of ticks past the newest snapshot. */
  renderTick(nowMs: number): number {
    const newest = this.newest;
    if (!newest || this.offset === null) return -Infinity;
    if (newest.tick - (nowMs / TICK_MS + this.offset - this.stats.renderDelayTicks) > MAX_LAG_TICKS) {
      this.offset = newest.tick - nowMs / TICK_MS; // the clock fell behind (tab was hidden): catch up
    }
    const wanted = nowMs / TICK_MS + this.offset - this.stats.renderDelayTicks;
    const rt = Math.min(Math.max(this.lastRender, wanted), newest.tick + MAX_EXTRAPOLATE_TICKS);
    this.lastRender = rt;
    this.stats.depth = this.snaps.filter((s) => s.tick > rt).length;
    return rt;
  }

  /** Snapshots whose tick the render tick has reached, oldest first, each handed out once (events fire here). */
  due(renderTick: number): Snapshot[] {
    const out = this.snaps.filter((s) => s.tick <= renderTick && s.tick > this.delivered);
    if (out.length) this.delivered = out[out.length - 1].tick;
    return out;
  }

  /** Events of snapshots that are still ahead of the render tick, up to `aheadTicks` out: a look at what is coming. */
  upcoming(renderTick: number, aheadTicks: number): { tick: number; events: GameEvent[] }[] {
    return this.snaps
      .filter((s) => s.tick > renderTick && s.tick <= renderTick + aheadTicks && s.events?.length)
      .map((s) => ({ tick: s.tick, events: s.events as GameEvent[] }));
  }

  /** Where everything stands at `renderTick`, or null before the first snapshot is reached. */
  sample(renderTick: number): Pose | null {
    let i = -1;
    for (let j = 0; j < this.snaps.length && this.snaps[j].tick <= renderTick; j++) i = j;
    if (i < 0) return null;
    const a = this.snaps[i];
    const b = this.snaps[i + 1];
    const prev = this.snaps[i - 1];
    const pa = a.observation.payload as ArenaPayload;
    let blend: Blend;
    let extrapolating = false;
    if (b) {
      const t = (renderTick - a.tick) / (b.tick - a.tick);
      const pb = b.observation.payload as ArenaPayload;
      blend = (id, from, kind) => {
        const to = (pb[kind] as { id: string; x: number; y: number }[]).find((e) => e.id === id);
        return to ? { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) } : from;
      };
    } else {
      extrapolating = renderTick > a.tick;
      if (extrapolating && renderTick < a.tick + MAX_EXTRAPOLATE_TICKS) this.stats.extrapolated += 1; // not while holding
      const pp = prev?.observation.payload as ArenaPayload | undefined;
      const span = prev ? a.tick - prev.tick : 0;
      blend = (id, from, kind) => {
        const was = (pp?.[kind] as { id: string; x: number; y: number }[] | undefined)?.find((e) => e.id === id);
        if (!was || span <= 0) return from;
        const k = (renderTick - a.tick) / span;
        return { x: from.x + (from.x - was.x) * k, y: from.y + (from.y - was.y) * k };
      };
    }
    const entities = new Map(pa.entities.map((e) => [e.id, blend(e.id, e, "entities")]));
    const projectiles = new Map(pa.projectiles.map((p) => [p.id, blend(p.id, p, "projectiles")]));
    return { entities, projectiles, extrapolating };
  }
}
