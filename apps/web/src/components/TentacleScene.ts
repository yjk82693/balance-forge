import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import {
  activePips,
  segmentCount,
  toCanvas,
  waveLabel,
  type TentacleEntity,
  type TentaclePayload,
} from "../lib/tentacle";

export const TENT_W = 1152;
export const TENT_H = 648;
const FONT = '"Inter", "Noto Sans KR", system-ui, sans-serif';

export interface TentacleAssets {
  rooftop: string;
  post: string;
  postTarget: string;
  segment: string;
  walker: string;
  drone: string;
  sentry: string;
  playerTrack: string;
  playerFill: string;
  sharkTrack: string;
  sharkFill: string;
  sharkPortrait: string;
  sharkName: string;
  sharkWarning: string;
  pipOn: string;
  pipOff: string;
  sepia: string;
}

const ENEMY_KEY: Record<string, string> = { walker: "walker", drone: "drone", sentry: "sentry" };
const ENEMY_PX = 56;

/**
 * Sepia Tentacle Run on the rooftop: the anchor posts, the tentacle between Sepia and the latched post, the walkers,
 * drones and sentries and their shots, and the Man-Shark's health bar when the boss is up. Reads Observations only.
 */
export class TentacleScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private ready = false;
  private onData = (_p: unknown, key: string) => {
    if (key === "obs") this.draw();
  };

  constructor() {
    super("tentacle");
  }

  preload() {
    const a = this.registry.get("assets") as TentacleAssets;
    this.load.image("rooftop", a.rooftop);
    this.load.image("post", a.post);
    this.load.image("post-target", a.postTarget);
    this.load.image("segment", a.segment);
    this.load.image("walker", a.walker);
    this.load.image("drone", a.drone);
    this.load.image("sentry", a.sentry);
    this.load.image("player-track", a.playerTrack);
    this.load.image("player-fill", a.playerFill);
    this.load.image("shark-track", a.sharkTrack);
    this.load.image("shark-fill", a.sharkFill);
    this.load.image("shark-portrait", a.sharkPortrait);
    this.load.image("shark-name", a.sharkName);
    this.load.image("shark-warning", a.sharkWarning);
    this.load.image("pip-on", a.pipOn);
    this.load.image("pip-off", a.pipOff);
    this.load.image("sepia", a.sepia);
  }

  create() {
    this.add.image(0, 0, "rooftop").setOrigin(0, 0).setDisplaySize(TENT_W, TENT_H);
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
    const obs = this.registry.get("obs") as Observation<TentaclePayload> | undefined;
    this.layer.removeAll(true);
    if (!obs) return;
    const p = obs.payload;
    const at = (e: { x: number; y: number }) => toCanvas(e, TENT_W, TENT_H);
    const me = p.entities.find((e) => e.kind === "player");

    // posts, the latched one marked
    for (const post of p.posts) {
      const c = at(post);
      const key = post.id === me?.latch?.post ? "post-target" : "post";
      this.layer.add(this.add.image(c.x, c.y, key).setDisplaySize(44, 44));
    }
    // the tentacle: body segments from Sepia to the post
    const latched = me?.latch ? p.posts.find((q) => q.id === me.latch?.post) : undefined;
    if (me && latched) this.tentacle(at(me), at(latched));
    // enemies and their shots
    for (const e of p.entities) {
      if (e.kind === "boss") this.bossBody(at(e));
      else if (e.kind !== "player") this.enemy(e, at(e));
    }
    for (const s of p.projectiles) {
      const c = at(s);
      this.layer.add(this.add.circle(c.x, c.y, 6, 0xf2b84b).setStrokeStyle(2, 0x0d1219));
    }
    if (me) this.sepia(me, at(me));
    this.hud(p, me);
  }

  private tentacle(from: { x: number; y: number }, to: { x: number; y: number }) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const seg = 28;
    const n = segmentCount(dist, seg);
    const angle = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const img = this.add.image(from.x + dx * t, from.y + dy * t, "segment");
      img.setRotation(angle).setDisplaySize(Math.max(seg, dist / n) + 2, seg / 4 * 1.0 + 12);
      this.layer.add(img);
    }
  }

  /** the Man-Shark on the rooftop: its portrait, large, with a red ring */
  private bossBody(c: { x: number; y: number }) {
    this.layer.add(this.add.image(c.x, c.y, "shark-portrait").setDisplaySize(120, 120));
    this.layer.add(this.add.circle(c.x, c.y, 62).setStrokeStyle(4, 0xff5c5c));
  }

  private enemy(e: TentacleEntity, c: { x: number; y: number }) {
    const key = ENEMY_KEY[e.kind];
    if (!key) return;
    this.layer.add(this.add.image(c.x, c.y, key).setDisplaySize(ENEMY_PX, ENEMY_PX));
    if (e.maxHp > 0 && e.hp < e.maxHp) {
      const w = 40;
      this.layer.add(this.add.rectangle(c.x - w / 2, c.y - ENEMY_PX / 2 - 4, w, 4, 0x0d1219).setOrigin(0, 0.5));
      const left = Math.max(0, e.hp / e.maxHp);
      this.layer.add(
        this.add.rectangle(c.x - w / 2, c.y - ENEMY_PX / 2 - 4, w * left, 4, 0xff5c5c).setOrigin(0, 0.5),
      );
    }
  }

  private sepia(e: TentacleEntity, c: { x: number; y: number }) {
    this.layer.add(this.add.circle(c.x, c.y, 26, 0x0d1219, 0.6));
    this.layer.add(this.add.image(c.x, c.y, "sepia").setDisplaySize(48, 48));
    this.layer.add(this.add.circle(c.x, c.y, 26).setStrokeStyle(3, 0xb08af0));
    const max = e.maxHp ?? e.hp;
    const w = 56;
    this.layer.add(this.add.rectangle(c.x - w / 2, c.y - 40, w, 6, 0x0d1219).setOrigin(0, 0.5));
    this.layer.add(this.add.rectangle(c.x - w / 2, c.y - 40, w * Math.max(0, e.hp / (max || 1)), 6, 0x5bd0a0)
      .setOrigin(0, 0.5));
  }

  private hud(p: TentaclePayload, me: TentacleEntity | undefined) {
    // wave counter and Sepia's health, top left
    this.layer.add(this.add.image(20, 18, "player-track").setOrigin(0, 0).setDisplaySize(280, 38));
    if (me) {
      const max = me.maxHp ?? me.hp;
      const fill = Math.max(0, Math.min(1, me.hp / (max || 1)));
      this.layer.add(this.add.image(30, 28, "player-fill").setOrigin(0, 0).setDisplaySize(260 * fill, 18));
      this.text(20, 62, `HP ${me.hp}/${max}`, 16);
    }
    const boss = p.boss;
    this.text(TENT_W / 2, 20, waveLabel(p), 22).setOrigin(0.5, 0);
    if (!boss) return;
    // the Man-Shark: nameplate, health bar and phase pips along the top
    const cx = TENT_W / 2;
    this.layer.add(this.add.image(cx - 330, 48, "shark-portrait").setOrigin(0.5, 0).setDisplaySize(64, 64));
    this.layer.add(this.add.image(cx, 54, "shark-track").setOrigin(0.5, 0).setDisplaySize(640, 48));
    const fill = Math.max(0, Math.min(1, boss.hp / (boss.maxHp || 1)));
    this.layer.add(this.add.image(cx - 310, 64, "shark-fill").setOrigin(0, 0).setDisplaySize(620 * fill, 28));
    for (let i = 0; i < boss.phases; i++) {
      const on = i < activePips(boss.phase, boss.phases);
      this.layer.add(
        this.add.image(cx - 20 * boss.phases + i * 40 + 20, 108, on ? "pip-on" : "pip-off").setDisplaySize(28, 28),
      );
    }
  }
}
