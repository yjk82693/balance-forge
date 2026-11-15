import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import { groundSegments, progress, sectionLabel, toScreenX, type RunnerPayload } from "../lib/runner";
import { segmentCount } from "../lib/tentacle";

export const RUN_W = 1152;
export const RUN_H = 648;
const GROUND_Y = 560; // screen y of the ground line (y = 0 in the world)
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
}

/**
 * Sepia Tentacle Run as a side-scroller: a sky and city parallax from the rooftop art, the ground with its pits,
 * walls and low bars, the anchor posts, Sepia (running, jumping, sliding, swinging) and the wire to the anchor, the section label
 * and course progress, and the Man-Shark chasing in the last section. Reads Observations only.
 */
export class RunnerScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private ready = false;
  private onData = (_p: unknown, key: string) => {
    if (key === "obs") this.draw();
  };

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
  }

  create() {
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

  private draw() {
    if (!this.ready) return;
    const obs = this.registry.get("obs") as Observation<RunnerPayload> | undefined;
    this.layer.removeAll(true);
    if (!obs) return;
    const p = obs.payload;
    const k = RUN_W / p.viewWidth; // world unit to pixel, the same up and across
    const sx = (wx: number) => toScreenX(wx, p.cameraX, p.viewWidth, RUN_W);
    const sy = (wy: number) => GROUND_Y - wy * k;
    this.parallax(p.cameraX * k);
    this.ground(p, sx, k);
    for (const o of p.obstacles) this.obstacle(o, sx, sy, k);
    const wire = p.player.wire;
    for (const a of p.anchors) {
      const x = sx(a.x);
      if (x < -60 || x > RUN_W + 60) continue;
      const key = a.id === wire?.anchorId ? "post-target" : "post";
      this.layer.add(this.add.image(x, sy(a.y), key).setDisplaySize(52, 52));
    }
    if (p.shark) this.shark(sx(p.shark.x));
    const me = { x: sx(p.player.x), y: sy(p.player.y) };
    if (wire && p.player.state === "swinging") {
      this.wire(me, { x: sx(wire.anchorX), y: sy(wire.anchorY) }, p.player.height * k);
    }
    this.sepia(me, p, k);
    this.hud(p);
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
    const from = p.cameraX - 500;
    const to = p.cameraX + p.viewWidth + 500;
    const pits = p.obstacles.filter((o) => o.kind === "pit");
    const g = this.add.graphics();
    for (const [a, b] of groundSegments(pits, from, to)) {
      g.fillStyle(0x1c2233, 1);
      g.fillRect(sx(a), GROUND_Y, (b - a) * k, RUN_H - GROUND_Y);
      g.fillStyle(0x58e6a9, 0.9);
      g.fillRect(sx(a), GROUND_Y, (b - a) * k, 4);
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
    const g = this.add.graphics();
    if (o.kind === "pit") {
      g.fillStyle(0x05070d, 0.92);
      g.fillRect(x, GROUND_Y, w, RUN_H - GROUND_Y); // the dark gap in the ground
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

  private sepia(c: { x: number; y: number }, p: RunnerPayload, k: number) {
    const state = p.player.state;
    const h = p.player.height * k; // 86 px standing, 36 px sliding
    const r = Math.max(18, h / 2);
    const cy = c.y - h / 2;
    this.layer.add(this.add.circle(c.x, cy, r, 0x0d1219, 0.6));
    const img = this.add.image(c.x, cy, "sepia").setDisplaySize(r * 1.7, state === "sliding" ? r * 1.2 : r * 1.7);
    if (state === "swinging") img.setRotation(0.4);
    this.layer.add(img);
    this.layer.add(this.add.circle(c.x, cy, r).setStrokeStyle(3, 0xb08af0));
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
}
