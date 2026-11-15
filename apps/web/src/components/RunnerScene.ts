import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import {
  chasmAnchor,
  groundSegments,
  jumpTrail,
  progress,
  sectionLabel,
  toScreenX,
  type RunnerPayload,
  type TrailPoint,
} from "../lib/runner";
import { segmentCount } from "../lib/tentacle";
import {
  barFill,
  cssColor,
  laneColor,
  laneLabel,
  laneTint,
  versusCameraLeft,
  versusOf,
  type VersusInfo,
  type VersusRunner,
} from "../lib/runnerVersus";
import {
  buildingSlot,
  feetOrigin,
  hookDisplay,
  hookPlacement,
  sepiaSlot,
  spriteDisplay,
  type RunnerMeta,
} from "../lib/runnerArt";

export const RUN_W = 1152;
export const RUN_H = 648;
const GROUND_Y = 590; // screen y of the ground line (y = 0 in the world); the anchors (4500 high) still fit above it
/** The camera is zoomed on the web side: ~9400 of the engine's 16000 units are drawn across, Sepia ~150 px tall. */
export const ZOOM = 1.7;
const FONT = '"Inter", "Noto Sans KR", system-ui, sans-serif';
const SKY_TOP = 0x0b1020;
const SKY_BOTTOM = 0x2a1a4a;

export interface RunnerAssets {
  rooftop: string;
  post: string;
  postTarget: string;
  segment: string;
  sharkPortrait: string;
  sepia: string;
  /** the delivered art slots that exist (slot name to url) and the slicer's meta */
  art: Record<string, string>;
  meta: RunnerMeta;
}

/**
 * Sepia Tentacle Run as a side-scroller: a sky and city parallax from the rooftop art, the ground with its pits,
 * walls and low bars, the anchor posts, Sepia (running, jumping, sliding, swinging) and the wire to the anchor, the
 * section label
 * and course progress, and the Man-Shark chasing in the last section. Reads Observations only.
 */
export class RunnerScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private ready = false;
  /** a new observation only marks the scene dirty; it is drawn once per frame, however many views arrived */
  private dirty = false;
  private onData = (_p: unknown, key: string) => {
    if (key === "obs") this.dirty = true;
  };

  override update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  /** the pixel size of a delivered art slot's texture */
  private tex(slot: string): { w: number; h: number } {
    const src = this.textures.get(this.art(slot)).getSourceImage() as { width: number; height: number };
    return { w: src.width, h: src.height };
  }

  constructor() {
    super("runner");
  }

  preload() {
    const a = this.registry.get("assets") as RunnerAssets;
    this.load.image("rooftop", a.rooftop);
    this.load.image("post", a.post);
    this.load.image("post-target", a.postTarget);
    this.load.image("segment", a.segment);
    this.load.image("shark-portrait", a.sharkPortrait);
    this.load.image("sepia", a.sepia);
    for (const [slot, url] of Object.entries(a.art)) this.load.image(`art:${slot}`, url);
  }

  private bg: Partial<Record<"far" | "mid" | "near", Phaser.GameObjects.TileSprite>> = {};
  private bgScale: Partial<Record<"far" | "mid" | "near", number>> = {};
  private art = (slot: string) => `art:${slot}`;
  private has = (slot: string) => this.textures.exists(`art:${slot}`);
  private meta!: RunnerMeta;

  create() {
    this.meta = (this.registry.get("assets") as RunnerAssets).meta;
    // the three parallax layers (2048x1024 art scaled to the view height), far and mid behind the scene, near in front
    const layers = [["far", -30, "bg_far"], ["mid", -20, "bg_mid"], ["near", -10, "bg_near"]] as const;
    for (const [key, depth, name] of layers) {
      if (!this.has(name)) continue;
      const t = this.add.tileSprite(0, 0, RUN_W, RUN_H, this.art(name)).setOrigin(0, 0).setDepth(depth);
      const scale = RUN_H / this.tex(name).h; // the art fills the view height, whatever size it was delivered at
      t.setTileScale(scale, scale);
      this.bgScale[key] = scale;
      this.bg[key] = t;
    }
    this.layer = this.add.container(0, 0);
    this.ready = true;
    this.registry.events.on("changedata", this.onData);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off("changedata", this.onData));
    this.draw();
  }

  private text(x: number, y: number, s: string, size = 16, color = "#E6EBF1") {
    const t = this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: "700", color });
    t.setShadow(0, 1, "#0D1219", 4, false, true);
    this.layer.add(t);
    return t;
  }

  private camLeft: number | null = null;
  private camTick = 0;
  private laneName = (id: string) => laneLabel(id, this.registry.get("names") as Record<string, string> | undefined);

  private draw() {
    if (!this.ready) return;
    const obs = this.registry.get("obs") as Observation<RunnerPayload> | undefined;
    this.layer.removeAll(true);
    if (!obs) return;
    const p = obs.payload;
    const k = (ZOOM * RUN_W) / p.viewWidth; // world unit to pixel, the same up and across
    // Sepia keeps the engine's lead from the left edge (a quarter of the view); the world scrolls around her
    const lead = Math.max(0.1, Math.min(0.5, (p.player.x - p.cameraX) / p.viewWidth));
    const span = RUN_W / k;
    const vs = versusOf(p);
    // Versus: frame both runners (eased, so the switch to following the leader is not a jump)
    let left = p.player.x - lead * span;
    if (vs && vs.runners.length) {
      const want = versusCameraLeft(vs.runners.map((r) => r.x), span, lead);
      const far = this.camLeft === null || obs.tick < this.camTick || Math.abs(want - this.camLeft) > 2 * span;
      this.camLeft = far ? want : this.camLeft! + (want - this.camLeft!) * 0.15;
      this.camTick = obs.tick;
      left = this.camLeft;
    } else this.camLeft = null;
    const sx = (wx: number) => toScreenX(wx, left, span, RUN_W);
    const sy = (wy: number) => GROUND_Y - wy * k;
    this.scrollBackgrounds(left * k);
    this.ground(p, sx, k);
    for (const o of p.obstacles) this.obstacle(o, sx, sy, k);
    this.trails(p, sx, sy);
    const wire = p.player.wire;
    for (const a of p.anchors) this.anchor(a, sx(a.x), sy(a.y), a.id === wire?.anchorId);
    if (p.shark) this.shark(sx(p.shark.x));
    const mine = {
      x: p.player.x,
      y: p.player.y,
      vy: p.player.vy,
      state: p.player.state,
      height: p.player.height,
      wire,
      down: vs ? !vs.runners.find((r) => r.id === vs.leader)?.alive : undefined,
    };
    if (vs) {
      for (const r of vs.runners) if (r.id !== vs.leader) this.rival(r, sx, sy, k);
    }
    const who = (id: string) => ({ label: this.laneName(id), color: laneColor(id), tint: laneTint(id) });
    this.runner(mine, p, sx, sy, k, vs ? who(vs.leader) : undefined);
    if (vs) this.versusHud(p, vs);
    else this.hud(p);
  }

  /** one runner at its place: the wire when it swings and the pose; `style` labels and tints it in a versus match */
  private runner(
    r: Pose,
    p: RunnerPayload,
    sx: (x: number) => number,
    sy: (y: number) => number,
    k: number,
    style?: { label: string; color: number; tint: number },
    atX?: number,
  ) {
    const at = { x: atX ?? sx(r.x), y: sy(r.y) };
    const wire = r.wire;
    const anchor = wire ? { x: sx(wire.anchorX), y: sy(wire.anchorY) } : undefined;
    if (wire && r.state === "swinging" && !this.has("sepia_swing")) this.wire(at, anchor!, r.height * k);
    this.sepia(at, r, p, k, anchor, style?.tint);
    if (style) {
      const top = at.y - r.height * k - 14;
      this.text(at.x, top, style.label, 20, cssColor(style.color)).setOrigin(0.5, 1);
      this.layer.add(this.add.ellipse(at.x, at.y, 90, 18).setStrokeStyle(4, style.color, 0.9));
    }
  }

  /** the other runner of a versus match; one that fell off the left edge is held at the edge with an arrow */
  private rival(
    r: VersusRunner,
    sx: (x: number) => number,
    sy: (y: number) => number,
    k: number,
  ) {
    const pose: Pose = {
      x: r.x,
      y: r.y ?? 0,
      vy: 0,
      state: r.state as Pose["state"],
      height: r.height ?? (r.state === "sliding" ? 500 : 1200),
      wire: r.wire ?? null,
      down: !r.alive,
    };
    const edge = 40;
    const want = sx(r.x);
    const at = Math.max(edge, Math.min(RUN_W - edge, want));
    const name = this.laneName(r.id);
    const label = want < edge ? `◀ ${name}` : want > RUN_W - edge ? `${name} ▶` : name;
    const p = this.registry.get("obs").payload as RunnerPayload;
    this.runner(pose, p, sx, sy, k, { label, color: laneColor(r.id), tint: laneTint(r.id) }, at);
  }

  /** the delivered layers scroll at three speeds; with none delivered the drawn sky and skylines stand in */
  private scrollBackgrounds(scrolled: number) {
    const { far, mid, near } = this.bg;
    if (far) far.tilePositionX = (scrolled * 0.1) / (this.bgScale.far ?? 1);
    if (mid) mid.tilePositionX = (scrolled * 0.3) / (this.bgScale.mid ?? 1);
    if (near) near.tilePositionX = (scrolled * 0.7) / (this.bgScale.near ?? 1);
    if (!far) this.parallax(scrolled);
  }

  /** sky gradient, the rooftop art far away and slow, and two skylines of code-drawn blocks */
  private parallax(scrolled: number) {
    const g = this.add.graphics();
    g.fillGradientStyle(SKY_TOP, SKY_TOP, SKY_BOTTOM, SKY_BOTTOM, 1);
    g.fillRect(0, 0, RUN_W, RUN_H);
    this.layer.add(g);
    // the city and lights at the top of the rooftop art, far away and slow, as the sky
    const off = -((scrolled * 0.08) % RUN_W);
    for (const dx of [0, RUN_W]) {
      const sky = this.add.image(off + dx, 0, "rooftop").setOrigin(0, 0).setDisplaySize(RUN_W, RUN_H).setAlpha(0.6);
      sky.setCrop(0, 0, sky.width, sky.height * 0.2);
      this.layer.add(sky);
    }
    // fade the strip into the night sky below it
    const fade = this.add.graphics();
    fade.fillGradientStyle(SKY_TOP, SKY_TOP, SKY_TOP, SKY_TOP, 0, 0, 1, 1);
    fade.fillRect(0, RUN_H * 0.08, RUN_W, RUN_H * 0.14);
    this.layer.add(fade);
    for (const [factor, color, base, tall] of [[0.2, 0x151a33, 470, 90], [0.4, 0x0f1326, 520, 70]] as const) {
      const sky = this.add.graphics();
      sky.fillStyle(color, 1);
      const shift = (scrolled * factor) % 240;
      for (let i = -1; i < RUN_W / 120 + 2; i++) {
        const h = 60 + (((i + Math.floor((scrolled * factor) / 240) * 2) * 37) % 100 + 100) % 100 * (tall / 100);
        sky.fillRect(i * 120 - shift, base - h, 100, h + 80);
      }
      this.layer.add(sky);
    }
  }

  private ground(p: RunnerPayload, sx: (x: number) => number, k: number) {
    const left = p.player.x - sx(p.player.x) / k; // the world x at the left edge of the screen
    const from = left - 500;
    const to = left + RUN_W / k + 500;
    const pits = p.obstacles.filter((o) => o.kind === "pit");
    const g = this.add.graphics();
    const tile = this.has("ground_tile");
    const tileH = tile ? this.tex("ground_tile").h : 128;
    const TILE = (700 * k) / tileH; // the tile is 700 world units tall, so it zooms with the world
    for (const [a, b] of groundSegments(pits, from, to)) {
      if (tile) {
        const t = this.add.tileSprite(sx(a), GROUND_Y, (b - a) * k, RUN_H - GROUND_Y, this.art("ground_tile"));
        t.setOrigin(0, 0).setTileScale(TILE, TILE);
        t.tilePositionX = (a * k) / TILE;
        this.layer.add(t);
        continue;
      }
      g.fillStyle(0x1c2233, 1);
      g.fillRect(sx(a), GROUND_Y, (b - a) * k, RUN_H - GROUND_Y);
      g.fillStyle(0x58e6a9, 0.9);
      g.fillRect(sx(a), GROUND_Y, (b - a) * k, 4);
    }
    if (this.has("pit_edge")) {
      for (const pit of pits) {
        const left = sx(pit.x);
        const right = sx(pit.x + pit.w);
        if (right < -140 || left > RUN_W + 140) continue;
        const e = this.tex("pit_edge");
        const w = e.w * TILE;
        const h = e.h * TILE;
        this.layer.add(this.add.image(left, GROUND_Y, this.art("pit_edge")).setOrigin(1, 0).setDisplaySize(w, h));
        this.layer.add(
          this.add.image(right, GROUND_Y, this.art("pit_edge")).setOrigin(0, 0).setFlipX(true).setDisplaySize(w, h),
        );
      }
    }
    // the finish line
    const fx = sx(p.finishX);
    if (fx > 0 && fx < RUN_W) {
      g.fillStyle(0xf2b84b, 1);
      g.fillRect(fx, GROUND_Y - 200, 6, 200);
    }
    this.layer.add(g);
  }

  private obstacle(
    o: RunnerPayload["obstacles"][number],
    sx: (x: number) => number,
    sy: (y: number) => number,
    k: number,
  ) {
    const x = sx(o.x);
    const w = o.w * k;
    if (x > RUN_W + 40 || x + w < -40) return;
    const art = o.kind === "lowBar" ? "low_bar" : o.kind === "wall" ? "wall" : "";
    if (art && this.has(art)) {
      const top = sy(o.y + o.h);
      if (o.kind === "lowBar") {
        // one pipe stretched over the bar
        this.layer.add(this.add.image(x, top, this.art(art)).setOrigin(0, 0).setDisplaySize(w, o.h * k));
        return;
      }
      // a wall: the block repeated upward, as wide as the wall
      const native = this.tex("wall");
      const t = this.add.tileSprite(x, top, w, o.h * k, this.art(art)).setOrigin(0, 0);
      t.setTileScale(w / native.w, w / native.w);
      t.tilePositionY = native.h; // start the repeat from the ground up
      this.layer.add(t);
      return;
    }
    const g = this.add.graphics();
    if (o.kind === "pit") {
      // the chasm: dark depth that glows faintly neon toward the bottom, with a violet-teal glow along its walls
      g.fillGradientStyle(0x05070d, 0x05070d, 0x2a1050, 0x2a1050, 0.96, 0.96, 0.95, 0.95);
      g.fillRect(x, GROUND_Y, w, RUN_H - GROUND_Y);
      g.fillStyle(0x58e6e0, 0.1);
      g.fillRect(x, GROUND_Y, 6, RUN_H - GROUND_Y);
      g.fillRect(x + w - 6, GROUND_Y, 6, RUN_H - GROUND_Y);
      g.fillStyle(0xd050ff, 0.18);
      g.fillRect(x, RUN_H - 22, w, 22);
      g.fillStyle(0xff5c5c, 0.6);
      g.fillRect(x, GROUND_Y, w, 4); // the warning glow along its mouth
    } else {
      const top = sy(o.y + o.h);
      g.fillStyle(0x3a4560, 1);
      g.fillRect(x, top, w, o.h * k);
      g.lineStyle(3, o.kind === "wall" ? 0xff8a3d : 0xf2b84b, 1);
      g.strokeRect(x, top, w, o.h * k);
    }
    this.layer.add(g);
  }

  /**
   * A guide trail of small glowing dots: an arc over each chasm (rising toward its anchor, down on the far side) and
   * the jump arc over each narrow pit. Visual only. A pit counts as a chasm only when an anchor above it says `overPit`.
   */
  private trails(p: RunnerPayload, sx: (x: number) => number, sy: (y: number) => number) {
    const g = this.add.graphics();
    const dots = (pts: TrailPoint[], color: number) => {
      pts.forEach((pt, i) => {
        const x = sx(pt.x);
        if (x < -20 || x > RUN_W + 20) return;
        const y = sy(pt.y);
        const pulse = 0.55 + 0.25 * Math.sin(i * 0.9);
        g.fillStyle(color, 0.16 * pulse);
        g.fillCircle(x, y, 11);
        g.fillStyle(color, 0.9);
        g.fillCircle(x, y, 4.5);
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(x - 1, y - 1, 1.8);
      });
    };
    const step = 360; // world units between dots
    for (const pit of p.obstacles.filter((o) => o.kind === "pit")) {
      if (sx(pit.x + pit.w) < -200 || sx(pit.x) > RUN_W + 200) continue;
      const anchor = chasmAnchor(pit, p.anchors);
      // over a chasm the dots rise toward the anchor and come down on the far side (visible above the ground)
      if (anchor) dots(jumpTrail(pit, 700, Math.min(3000, anchor.y * 0.6), step), 0x58e6e0);
      else if (pit.w <= 4000) dots(jumpTrail(pit, 500, 1000, step * 0.8), 0xf2d84b);
    }
    this.layer.add(g);
  }

  /** the Man-Shark chasing from behind: its portrait, large, with a red ring */
  private shark(x: number) {
    this.layer.add(this.add.image(x, GROUND_Y - 110, "shark-portrait").setDisplaySize(220, 220));
    this.layer.add(this.add.circle(x, GROUND_Y - 110, 112).setStrokeStyle(5, 0xff5c5c));
  }

  /** the tentacle from Sepia (her body top) to the anchor */
  private wire(from: { x: number; y: number }, to: { x: number; y: number }, bodyHeight: number) {
    from = { x: from.x, y: from.y - bodyHeight * 0.8 };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const n = segmentCount(dist, 28);
    const angle = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      this.layer.add(
        this.add
          .image(from.x + dx * t, from.y + dy * t, "segment")
          .setRotation(angle)
          .setDisplaySize(Math.max(28, dist / n) + 2, 16),
      );
    }
  }

  /** a hook building under the anchor with its ring at the anchor point; the post sprite when none is delivered */
  private anchor(a: RunnerPayload["anchors"][number], x: number, y: number, hooked: boolean) {
    if (x < -300 || x > RUN_W + 300) return;
    const slot = buildingSlot(a.id);
    // over a chasm the structure rises from the bottom of the screen, like a pillar out of the pit
    const base = a.overPit ? RUN_H + 6 : GROUND_Y;
    const placed = this.has(slot) ? hookPlacement(slot, base - y, this.meta) : null;
    if (placed) {
      const img = this.add.image(x, y, this.art(slot)).setOrigin(placed.originX, placed.originY);
      img.setDisplaySize(placed.width, placed.height);
      if (hooked) img.setTint(0xcfffee);
      this.layer.add(img);
      return;
    }
    if (this.has(slot)) {
      const size = hookDisplay(base - y, this.meta);
      const img = this.add.image(x, base, this.art(slot)).setOrigin(0.5, 1).setDisplaySize(size, size);
      if (hooked) img.setTint(0xcfffee);
      this.layer.add(img);
      return;
    }
    this.layer.add(this.add.image(x, y, hooked ? "post-target" : "post").setDisplaySize(52, 52));
  }

  private sepia(
    c: { x: number; y: number },
    r: Pose,
    p: RunnerPayload,
    k: number,
    anchor?: { x: number; y: number },
    tint?: number,
  ) {
    const state = r.state;
    const slot = sepiaSlot({
      state,
      vy: r.vy,
      x: r.x,
      hooking: !!r.wire && state !== "swinging",
      down: r.down ?? (!!p.outcome && p.outcome.status !== "running" && p.outcome.reason !== "finish"),
    });
    const bodyPx = 1200 * k; // a standing body, in screen pixels
    if (this.has(slot)) {
      const size = spriteDisplay(bodyPx, this.meta);
      if (slot === "sepia_swing" && anchor) {
        this.swingSprite(slot, c, anchor, size, tint);
        return;
      }
      const img = this.add.image(c.x, c.y, this.art(slot)).setOrigin(0.5, feetOrigin(this.meta));
      if (tint !== undefined) img.setTint(tint);
      this.layer.add(img.setDisplaySize(size, size));
      return;
    }
    const h = r.height * k; // 86 px standing, 36 px sliding
    const rad = Math.max(18, h / 2);
    const cy = c.y - h / 2;
    this.layer.add(this.add.circle(c.x, cy, rad, 0x0d1219, 0.6));
    const img = this.add.image(c.x, cy, "sepia").setDisplaySize(rad * 1.7, state === "sliding" ? rad * 1.2 : rad * 1.7);
    if (tint !== undefined) img.setTint(tint);
    if (state === "swinging") img.setRotation(0.4);
    this.layer.add(img);
    this.layer.add(this.add.circle(c.x, cy, rad).setStrokeStyle(3, 0xb08af0));
  }

  /** the hanging pose, turned so she hangs from the anchor; the tentacle segments run from the anchor to her hand */
  private swingSprite(
    slot: string,
    c: { x: number; y: number },
    anchor: { x: number; y: number },
    size: number,
    tint?: number,
  ) {
    const dx = c.x - anchor.x;
    const dy = c.y - anchor.y;
    const theta = -Math.atan2(dx, Math.max(1, dy));
    const origin = 0.85; // the body hangs at this fraction down the cell
    const img = this.add.image(c.x, c.y, this.art(slot)).setOrigin(0.5, origin);
    img.setDisplaySize(size, size).setRotation(theta);
    if (tint !== undefined) img.setTint(tint);
    this.layer.add(img);
    const reach = origin * size; // from her to the top of the cell, where the tentacle leaves it
    this.wire(anchor, { x: c.x + Math.sin(theta) * reach, y: c.y - Math.cos(theta) * reach }, 0);
  }

  private hud(p: RunnerPayload) {
    this.text(RUN_W / 2, 18, sectionLabel(p), 22).setOrigin(0.5, 0);
    // course progress with the finish flag
    const x0 = 60;
    const w = RUN_W - 120;
    this.layer.add(this.add.rectangle(x0, 62, w, 6, 0x0d1219, 0.7).setOrigin(0, 0.5));
    this.layer.add(this.add.rectangle(x0, 62, w * progress(p), 6, 0x58e6a9).setOrigin(0, 0.5));
    this.layer.add(this.add.circle(x0 + w * progress(p), 62, 8, 0xe6ebf1));
    this.layer.add(this.add.rectangle(x0 + w, 62, 4, 18, 0xf2b84b));
  }

  /** a versus match: one progress bar per runner (P1 above P2) with the finish flag */
  private versusHud(p: RunnerPayload, vs: VersusInfo) {
    this.text(RUN_W / 2, 14, sectionLabel(p), 22).setOrigin(0.5, 0);
    const x0 = 200; // room for a name of 16 characters
    const w = RUN_W - 260;
    vs.runners.forEach((r, i) => {
      const y = 62 + i * 26;
      const f = barFill(r.x, p.finishX);
      const tint = laneColor(r.id);
      this.text(24, y, this.laneName(r.id), 18, cssColor(tint)).setOrigin(0, 0.5);
      this.layer.add(this.add.rectangle(x0, y, w, 8, 0x0d1219, 0.7).setOrigin(0, 0.5));
      this.layer.add(this.add.rectangle(x0, y, w * f, 8, tint).setOrigin(0, 0.5));
      this.layer.add(this.add.circle(x0 + w * f, y, 9, tint).setStrokeStyle(2, 0xe6ebf1));
    });
    this.layer.add(this.add.rectangle(x0 + w, 75, 4, 50, 0xf2b84b));
  }
}

/** The pose of one runner: what the scene needs to draw it (the leader from the payload, the other from versus). */
interface Pose {
  x: number;
  y: number;
  vy: number;
  state: RunnerPayload["player"]["state"];
  height: number;
  wire: RunnerPayload["player"]["wire"];
  /** drawn lying down; leave out to follow the outcome (the solo run) */
  down?: boolean;
}
