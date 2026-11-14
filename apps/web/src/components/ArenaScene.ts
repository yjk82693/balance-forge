import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import { HERO_HEX, heroName } from "../lib/heroes";

export const ARENA_W = 1152;
export const ARENA_H = 648;

// Playable rectangle inside arena_floor.png (1920x1080 art), measured by eye, scaled to the 1152x648 canvas.
// Art-space playfield rectangle (1920x1080); multiplied by the canvas scale at runtime.
const FIELD_ART = { x: 150, y: 140, w: 1770 - 150, h: 1000 - 140 };
const HERO_SCALE = 0.3;
const FONT = '"Inter", "Noto Sans KR", system-ui, sans-serif';

export interface ArenaAssets {
  floor: string;
  heroes: Record<string, string>;
  arrow: string;
  hpTrack: string;
  hpFill: string;
}

interface HeroView {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  tx: number;
  ty: number;
}
interface HudView {
  fill: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  hp: Phaser.GameObjects.Text;
  fullW: number;
  fullH: number;
}

/** Draws the arena floor and heroes from an Observation. Reads data only; it never advances state. */
export class ArenaScene extends Phaser.Scene {
  /** canvas width / 1152: 1 on the full screen, smaller in the compare view */
  private k = 1;
  private heroes = new Map<string, HeroView>();
  private huds = new Map<string, HudView>();
  private arrows = new Map<string, Phaser.GameObjects.Image>();
  private latest: Observation | null = null;
  private ready = false;
  private onData = (_p: unknown, key: string, value: Observation | null) => {
    if (key === "obs" && value) this.apply(value);
  };

  constructor() {
    super("arena");
  }

  preload() {
    const a = this.registry.get("assets") as ArenaAssets;
    this.load.image("floor", a.floor);
    for (const [id, url] of Object.entries(a.heroes)) this.load.image(`hero:${id}`, url);
    this.load.image("arrow", a.arrow);
    this.load.image("hp-track", a.hpTrack);
    this.load.image("hp-fill", a.hpFill);
  }

  create() {
    this.k = this.scale.width / ARENA_W;
    this.add.image(0, 0, "floor").setOrigin(0, 0).setDisplaySize(this.scale.width, this.scale.height).setDepth(0);
    this.ready = true;
    this.registry.events.on("changedata", this.onData);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off("changedata", this.onData));
    const initial = (this.registry.get("obs") as Observation | undefined) ?? this.latest;
    if (initial) this.apply(initial);
  }

  private toScreen(x: number, y: number, arena: { w: number; h: number }) {
    const a = (this.scale.width / 1920);
    return { x: (FIELD_ART.x + (x / arena.w) * FIELD_ART.w) * a, y: (FIELD_ART.y + (y / arena.h) * FIELD_ART.h) * a };
  }

  private apply(obs: Observation) {
    this.latest = obs;
    if (!this.ready) return;
    const { arena, entities, projectiles } = obs.payload;

    entities.forEach((e, i) => {
      const p = this.toScreen(e.x, e.y, arena);
      let v = this.heroes.get(e.id);
      const key = `hero:${e.hero}`;
      if (!v || v.sprite.texture.key !== key) {
        v?.sprite.destroy();
        v?.shadow.destroy();
        const shadow = this.add.ellipse(p.x, p.y, 90 * this.k, 26 * this.k, 0x000000, 0.28).setDepth(1);
        const sprite = this.add.image(p.x, p.y, this.textures.exists(key) ? key : "__MISSING").setOrigin(0.5, 498 / 512).setScale(HERO_SCALE * this.k);
        v = { sprite, shadow, tx: p.x, ty: p.y };
        this.heroes.set(e.id, v);
        this.makeHud(e.id, e.hero, i === 0 ? "left" : "right");
      }
      v.tx = p.x;
      v.ty = p.y;
      v.sprite.setFlipX(e.facing === 180);
      this.updateHud(e.id, e.hero, e.hp, e.maxHp ?? 100);
    });

    const live = new Set<string>();
    for (const pr of projectiles) {
      live.add(pr.id);
      const p = this.toScreen(pr.x, pr.y, arena);
      let img = this.arrows.get(pr.id);
      if (!img) {
        img = this.add.image(p.x, p.y - 40 * this.k, "arrow").setScale(0.3 * this.k).setDepth(5000);
        this.arrows.set(pr.id, img);
      }
      const owner = entities.find((e) => e.id === pr.owner);
      img.setPosition(p.x, p.y - 40 * this.k).setFlipX(owner?.facing === 180);
    }
    for (const [id, img] of this.arrows) {
      if (!live.has(id)) {
        img.destroy();
        this.arrows.delete(id);
      }
    }
  }

  private makeHud(id: string, hero: string, side: "left" | "right") {
    const k = this.k;
    const trackW = 300 * k * (k < 1 ? 1.25 : 1);
    const fs = `${Math.round(14 * (k < 1 ? 1.5 : 1))}px`;
    const trackH = (38 / 340) * trackW;
    const x = side === "left" ? 24 * k : this.scale.width - 24 * k - trackW;
    const y = 18 * k;
    this.add.image(x, y, "hp-track").setOrigin(0, 0).setDisplaySize(trackW, trackH).setDepth(10000);
    const fullW = trackW - 24 * k;
    const fullH = (18 / 320) * fullW;
    const fill = this.add.image(x + 12 * k, y + trackH / 2 - fullH / 2, "hp-fill").setOrigin(0, 0).setDisplaySize(fullW, fullH).setDepth(10001);
    const ring = HERO_HEX[hero] ?? 0xffffff;
    this.add.circle(x + 6 * k, y + trackH + 14 * k, 5 * k, ring).setDepth(10001);
    const name = this.add
      .text(x + 18 * k, y + trackH + 5 * k, heroName(hero), { fontFamily: FONT, fontSize: fs, fontStyle: "700", color: "#E6EBF1" })
      .setDepth(10001)
      .setShadow(0, 1, "#0D1219", 4, false, true);
    const hp = this.add
      .text(x + trackW, y + trackH + 5 * k, "", { fontFamily: FONT, fontSize: fs, fontStyle: "500", color: "#E6EBF1" })
      .setOrigin(1, 0)
      .setDepth(10001)
      .setShadow(0, 1, "#0D1219", 4, false, true);
    this.huds.set(id, { fill, name, hp, fullW, fullH });
  }

  private updateHud(id: string, hero: string, hpValue: number, maxHp: number) {
    const h = this.huds.get(id);
    if (!h) return;
    const f = Math.max(0, Math.min(1, hpValue / maxHp)); // maxHp is optional in v0.1.1; 100 when absent
    h.fill.setCrop(0, 0, Math.max(1, f * h.fill.width), h.fill.height);
    h.fill.setDisplaySize(h.fullW, h.fullH);
    h.name.setText(heroName(hero));
    h.hp.setText(`HP ${hpValue}`);
  }

  update() {
    // Cosmetic smoothing only (display side, not simulation).
    for (const v of this.heroes.values()) {
      v.sprite.x += (v.tx - v.sprite.x) * 0.25;
      v.sprite.y += (v.ty - v.sprite.y) * 0.25;
      v.sprite.setDepth(100 + v.sprite.y);
      v.shadow.setPosition(v.sprite.x, v.sprite.y).setDepth(50 + v.sprite.y);
    }
  }
}
