import Phaser from "phaser";
import type { ArenaEntity, Observation } from "../lib/contract";
import { HERO_HEX, heroName } from "../lib/heroes";
import { blip, reducedMotion } from "../lib/sfx";

export const ARENA_W = 1152;
export const ARENA_H = 648;

// Art-space playfield rectangle (1920x1080); multiplied by the canvas scale at runtime.
const FIELD_ART = { x: 150, y: 140, w: 1770 - 150, h: 1000 - 140 };
const HERO_SCALE = 0.36;
const FONT = '"Inter", "Noto Sans KR", system-ui, sans-serif';

export interface ArenaAssets {
  floor: string;
  heroes: Record<string, string>;
  /** effect sprites by kind: spirit_arrow, crow_dive, ... */
  effects: Record<string, string>;
  hpTrack: string;
  hpFill: string;
}

interface HeroView {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  tx: number;
  ty: number;
  /** eased logical position; the sprite is drawn at (px, py - bob) */
  px: number;
  py: number;
  hp: number;
  squash: number; // decays to 0: positive = squashed (hit), shown as wider/shorter
  phase: number;
  ko: boolean;
}
interface HudView {
  fill: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  hp: Phaser.GameObjects.Text;
  fullW: number;
  fullH: number;
  shown: number; // displayed fraction, eased toward the real one
  target: number;
}
interface Trail {
  img: Phaser.GameObjects.Image;
  life: number;
}

/**
 * Draws the arena from Observations and adds cosmetic "feel": hit flash, shake by weight tier, floating numbers,
 * projectile trails, KO slow-motion, idle bob and squash-and-stretch. None of it feeds back into game state.
 * Motion effects are skipped under prefers-reduced-motion; the hit flash stays (a colour change, not movement).
 */
export class ArenaScene extends Phaser.Scene {
  private k = 1;
  private reduce = false;
  private silent = false;
  private heroes = new Map<string, HeroView>();
  private huds = new Map<string, HudView>();
  private arrows = new Map<string, Phaser.GameObjects.Image>();
  private trails: Trail[] = [];
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
    for (const [kind, url] of Object.entries(a.effects)) this.load.image(`fx:${kind}`, url);
    this.load.image("hp-track", a.hpTrack);
    this.load.image("hp-fill", a.hpFill);
  }

  create() {
    this.k = this.scale.width / ARENA_W;
    this.silent = this.k < 1; // the small compare canvases stay quiet
    this.reduce = reducedMotion();
    this.add.image(0, 0, "floor").setOrigin(0, 0).setDisplaySize(this.scale.width, this.scale.height).setDepth(0);
    this.ready = true;
    this.registry.events.on("changedata", this.onData);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.registry.events.off("changedata", this.onData);
      this.time.timeScale = 1;
    });
    const initial = (this.registry.get("obs") as Observation | undefined) ?? this.latest;
    if (initial) this.apply(initial);
  }

  private toScreen(x: number, y: number, arena: { w: number; h: number }) {
    const a = this.scale.width / 1920;
    return { x: (FIELD_ART.x + (x / arena.w) * FIELD_ART.w) * a, y: (FIELD_ART.y + (y / arena.h) * FIELD_ART.h) * a };
  }

  private sfx(kind: Parameters<typeof blip>[0]) {
    if (!this.silent) blip(kind);
  }

  private apply(obs: Observation) {
    this.latest = obs;
    if (!this.ready) return;
    const payload = obs.payload as import("../lib/contract").ArenaPayload;
    const { arena, entities, projectiles } = payload;

    entities.forEach((e, i) => {
      const p = this.toScreen(e.x, e.y, arena);
      let v = this.heroes.get(e.id);
      const key = `hero:${e.hero}`;
      if (!v || v.sprite.texture.key !== key) {
        v?.sprite.destroy();
        v?.shadow.destroy();
        const shadow = this.add.ellipse(p.x, p.y, 90 * this.k, 26 * this.k, 0x000000, 0.28).setDepth(1);
        const sprite = this.add.image(p.x, p.y, this.textures.exists(key) ? key : "__MISSING").setOrigin(0.5, 498 / 512).setScale(HERO_SCALE * this.k);
        v = { sprite, shadow, tx: p.x, ty: p.y, px: p.x, py: p.y, hp: e.hp, squash: 0, phase: i * 1.7, ko: false };
        this.heroes.set(e.id, v);
        this.makeHud(e.id, e.hero, i === 0 ? "left" : "right");
      }
      v.tx = p.x;
      v.ty = p.y;
      v.sprite.setFlipX(e.facing === 180);
      const max = e.maxHp ?? 100;
      if (e.hp < v.hp) this.onHit(e, v, v.hp - e.hp, max);
      else if (e.hp > v.hp) this.revive(v);
      v.hp = e.hp;
      this.updateHud(e.id, e.hero, e.hp, max);
    });

    const live = new Set<string>();
    for (const pr of projectiles) {
      live.add(pr.id);
      const p = this.toScreen(pr.x, pr.y, arena);
      const tex = this.textures.exists(`fx:${pr.kind}`) ? `fx:${pr.kind}` : "fx:spirit_arrow";
      let img = this.arrows.get(pr.id);
      const owner = entities.find((e) => e.id === pr.owner);
      if (!img) {
        img = this.add.image(p.x, p.y - 40 * this.k, tex).setScale(0.3 * this.k).setDepth(5000);
        this.arrows.set(pr.id, img);
        this.sfx("shoot");
      }
      img.setPosition(p.x, p.y - 40 * this.k).setFlipX(owner?.facing === 180);
      if (!this.reduce) this.addTrail(img, tex);
    }
    for (const [id, img] of this.arrows) {
      if (!live.has(id)) {
        img.destroy();
        this.arrows.delete(id);
      }
    }
  }

  private addTrail(src: Phaser.GameObjects.Image, tex: string) {
    const t = this.add.image(src.x, src.y, tex).setScale(src.scaleX * 0.9).setFlipX(src.flipX).setAlpha(0.45).setDepth(4990);
    this.trails.push({ img: t, life: 1 });
    if (this.trails.length > 24) this.trails.shift()?.img.destroy();
  }

  // ---- feel ----

  private onHit(e: ArenaEntity, v: HeroView, dmg: number, max: number) {
    const tier = dmg >= 0.25 * max ? 3 : dmg >= 0.14 * max ? 2 : 1; // weight tier from how hard it hit
    const k = this.k;
    v.sprite.setTintFill(0xffffff);
    this.time.delayedCall(80, () => v.sprite.clearTint());
    v.squash = 1;
    const spark = this.add.image(v.sprite.x, v.sprite.y - 70 * k, this.textures.exists("fx:hit_spark") ? "fx:hit_spark" : "fx:spirit_arrow").setScale(0.35 * k).setDepth(9000);
    this.tweens.add({ targets: spark, alpha: 0, scale: spark.scale * 1.4, duration: 220, onComplete: () => spark.destroy() });
    this.floatText(v.sprite.x, v.sprite.y - 120 * k, `-${dmg}`, tier >= 3 ? "#FF6B6B" : "#E6EBF1", 20 + tier * 4);
    if (!this.reduce) this.cameras.main.shake(100 + tier * 50, 0.0015 * tier);
    this.sfx("hit");
    if (e.hp <= 0) this.onKO(v);
  }

  private onKO(v: HeroView) {
    v.ko = true;
    v.sprite.setTint(0x7d8a9a);
    this.floatText(v.sprite.x, v.sprite.y - 150 * this.k, "KO", "#F2C14E", 40);
    this.sfx("ko");
    if (this.reduce) {
      v.sprite.setAlpha(0.55);
      return;
    }
    this.cameras.main.shake(350, 0.006);
    // Cosmetic slow motion: scene clock and tweens at 30% for about a second of real time.
    this.time.timeScale = 0.3;
    this.tweens.timeScale = 0.3;
    window.setTimeout(() => {
      if (!this.sys.isActive()) return;
      this.time.timeScale = 1;
      this.tweens.timeScale = 1;
    }, 1100);
    this.tweens.add({ targets: v.sprite, angle: v.sprite.flipX ? -80 : 80, alpha: 0.55, duration: 500, ease: "Quad.easeOut" });
  }

  private revive(v: HeroView) {
    v.ko = false;
    v.sprite.clearTint().setAlpha(1).setAngle(0);
  }

  private floatText(x: number, y: number, s: string, color: string, size: number) {
    const t = this.add
      .text(x, y, s, { fontFamily: FONT, fontSize: `${Math.round(size * (this.k < 1 ? 1.3 : 1))}px`, fontStyle: "700", color })
      .setOrigin(0.5)
      .setDepth(9500)
      .setShadow(0, 2, "#0D1219", 4, false, true);
    this.tweens.add({ targets: t, y: this.reduce ? y : y - 46 * this.k, alpha: 0, duration: 800, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }

  // ---- HUD ----

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
    this.add.circle(x + 8 * k, y + trackH + 6 * k + 11 * k, 5 * k, HERO_HEX[hero] ?? 0xffffff).setDepth(10002);
    const name = this.add
      .text(x + 18 * k, y + trackH + 6 * k, heroName(hero), { fontFamily: FONT, fontSize: fs, fontStyle: "700", color: "#E6EBF1", backgroundColor: "rgba(13,18,25,0.78)", padding: { x: 8 * k, y: 3 * k } })
      .setDepth(10001);
    const hp = this.add
      .text(x + trackW, y + trackH + 6 * k, "", { fontFamily: FONT, fontSize: fs, fontStyle: "700", color: "#E6EBF1", backgroundColor: "rgba(13,18,25,0.78)", padding: { x: 8 * k, y: 3 * k } })
      .setOrigin(1, 0)
      .setDepth(10001);
    this.huds.set(id, { fill, name, hp, fullW, fullH, shown: 1, target: 1 });
  }

  private updateHud(id: string, hero: string, hpValue: number, maxHp: number) {
    const h = this.huds.get(id);
    if (!h) return;
    h.target = Math.max(0, Math.min(1, hpValue / maxHp));
    h.name.setText(heroName(hero));
    h.hp.setText(`HP ${hpValue}`);
  }

  update(_t: number, delta: number) {
    const dt = delta / 16.7;
    const now = this.time.now;
    for (const v of this.heroes.values()) {
      const dx = v.tx - v.px;
      v.px += dx * 0.25;
      v.py += (v.ty - v.py) * 0.25;
      let sx = 1;
      let sy = 1;
      let bob = 0;
      if (!this.reduce) {
        const speed = Math.abs(dx) / this.k;
        const stretch = Math.min(0.1, speed * 0.012); // moving: a little longer and thinner
        sx += stretch;
        sy -= stretch;
        v.squash = Math.max(0, v.squash - 0.07 * dt); // hit: wider and shorter, settles back
        sx += 0.2 * v.squash;
        sy -= 0.2 * v.squash;
        if (!v.ko) {
          const b = Math.sin(now / 340 + v.phase);
          bob = b * 2.5 * this.k; // idle bob
          sy += b * 0.012;
        }
      }
      v.sprite.setScale(HERO_SCALE * this.k * sx, HERO_SCALE * this.k * sy);
      v.sprite.setPosition(v.px, v.py - bob).setDepth(100 + v.py);
      v.shadow.setPosition(v.px, v.py).setDepth(50 + v.py);
    }
    for (const h of this.huds.values()) {
      h.shown += (h.target - h.shown) * Math.min(1, 0.18 * dt);
      const f = Math.abs(h.shown - h.target) < 0.002 ? h.target : h.shown;
      h.fill.setCrop(0, 0, Math.max(1, f * h.fill.width), h.fill.height);
      h.fill.setDisplaySize(h.fullW, h.fullH);
    }
    for (let t = this.trails.length - 1; t >= 0; t--) {
      const tr = this.trails[t];
      tr.life -= 0.09 * dt;
      tr.img.setAlpha(Math.max(0, tr.life * 0.45));
      if (tr.life <= 0) {
        tr.img.destroy();
        this.trails.splice(t, 1);
      }
    }
  }
}
