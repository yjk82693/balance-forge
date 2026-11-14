import Phaser from "phaser";
import type { CardsEntity, CardsPayload, Observation } from "../lib/contract";
import { CARDS_RULES, summonArtName } from "../lib/cards";
import { heroName } from "../lib/heroes";

export const TABLE_W = 1152;
export const TABLE_H = 648;
const FONT = '"UI Symbols", "Inter", "Noto Sans KR", system-ui, sans-serif';
const VIOLET = 0xa98bff;
// Slot centres measured on table.png (1920x1080 art), scaled to the 1152x648 canvas.
const GameSlots = { left: [[138, 205], [138, 408]], right: [[1013, 205], [1013, 408]] } as const;

export interface CardsAssets {
  table: string;
  cardBack: string;
  hudSlot: string;
  deckCounter: string;
  turnBanner: string;
  iconHealth: string;
  iconDefense: string;
  iconMana: string;
  /** summon pictures by name (turret_drone, crow_flock, ...) */
  summons: Record<string, string>;
  /** the hero card frame and the small portrait, by hero id */
  frames: Record<string, string>;
  portraits: Record<string, string>;
}

export interface CardsMeta {
  /** seat -> display name */
  names: Record<string, string>;
  /** seat -> hero id, for the hero card on each side */
  heroes?: Record<string, string>;
}

/**
 * Hero Cards table: both sides' HP, ward, energy orbs, hand backs, deck count and two summon slots.
 * Reads Observations only.
 */
export class CardsScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private ready = false;
  private onData = (_p: unknown, key: string) => {
    if (key === "obs" || key === "meta") this.draw();
  };

  constructor() {
    super("cards");
  }

  preload() {
    const a = this.registry.get("assets") as CardsAssets;
    this.load.image("table", a.table);
    this.load.image("card-back", a.cardBack);
    this.load.image("hud-slot", a.hudSlot);
    this.load.image("deck-counter", a.deckCounter);
    this.load.image("turn-banner", a.turnBanner);
    this.load.image("icon-health", a.iconHealth);
    this.load.image("icon-defense", a.iconDefense);
    this.load.image("icon-mana", a.iconMana);
    for (const [name, url] of Object.entries(a.summons)) this.load.image(`summon:${name}`, url);
    for (const [hero, url] of Object.entries(a.frames)) this.load.image(`frame:${hero}`, url);
    for (const [hero, url] of Object.entries(a.portraits)) this.load.image(`portrait:${hero}`, url);
  }

  create() {
    this.add.image(0, 0, "table").setOrigin(0, 0).setDisplaySize(TABLE_W, TABLE_H);
    this.layer = this.add.container(0, 0);
    this.ready = true;
    this.registry.events.on("changedata", this.onData);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off("changedata", this.onData));
    this.draw();
  }

  private text(x: number, y: number, s: string, size = 16, color = "#E6EBF1", weight = "700") {
    const t = this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: weight, color });
    t.setShadow(0, 1, "#0D1219", 4, false, true);
    this.layer.add(t);
    return t;
  }

  private draw() {
    if (!this.ready) return;
    const obs = this.registry.get("obs") as Observation<CardsPayload> | undefined;
    const meta = (this.registry.get("meta") as CardsMeta | undefined) ?? { names: {} };
    this.layer.removeAll(true);
    if (!obs) return;
    const p = obs.payload;
    const sorted = [...p.entities].sort((a, b) => a.id.localeCompare(b.id));
    const [left, right] = sorted; // p1 on the left, p2 on the right: the table art draws two slots per side
    if (left) this.side(left, true, p, meta);
    if (right) this.side(right, false, p, meta);

    const activeName = meta.names[p.activePlayer] ?? p.activePlayer;
    const over = p.outcome.status !== "running";
    this.banner(over ? "Match over" : `Round ${p.round} of ${CARDS_RULES.rounds} · ${activeName}'s turn`);
  }

  private banner(label: string) {
    const img = this.add.nineslice(TABLE_W / 2, TABLE_H / 2, "turn-banner", undefined, 400, 60, 36, 36, 32, 24);
    this.layer.add(img);
    this.text(TABLE_W / 2, TABLE_H / 2 - 2, label, 17).setOrigin(0.5).setDepth(2);
  }

  /** The hero on its side from the first view: its card frame, portrait, name and HP. */
  private heroCard(e: CardsEntity, isLeft: boolean, meta: CardsMeta, max: number) {
    const hero = meta.heroes?.[e.id];
    if (!hero || !this.textures.exists(`frame:${hero}`)) return;
    const w = 112;
    const h = (768 / 512) * w;
    const x = isLeft ? 250 : 790;
    const y = 238;
    this.layer.add(this.add.image(x, y, `frame:${hero}`).setOrigin(0, 0).setDisplaySize(w, h));
    if (this.textures.exists(`portrait:${hero}`)) {
      const side = w * 0.86;
      this.layer.add(this.add.image(x + w / 2, y + h * 0.14 + (h * 0.47 - side) / 2, `portrait:${hero}`)
        .setOrigin(0.5, 0).setDisplaySize(side, side));
    }
    this.text(x + w / 2, y + h * 0.66, heroName(hero), 15).setOrigin(0.5, 0);
    this.text(x + w / 2, y + h * 0.78, `HP ${e.hp}/${max}`, 14, "#F2B84B").setOrigin(0.5, 0);
  }

  private side(e: CardsEntity, isLeft: boolean, p: CardsPayload, meta: CardsMeta) {
    const active = p.activePlayer === e.id && p.outcome.status === "running";
    const max = e.maxHp ?? CARDS_RULES.health;
    const x0 = isLeft ? 236 : 916 - 312;
    const y0 = 96;

    this.text(x0, y0, `${meta.names[e.id] ?? e.id}${active ? "  ● turn" : ""}`, 18, active ? "#F2B84B" : "#E6EBF1");

    const plate = (x: number, y: number, icon: string, label: string) => {
      this.layer.add(this.add.nineslice(x, y, "hud-slot", undefined, 148, 50, 36, 36, 29, 24).setOrigin(0, 0));
      this.layer.add(this.add.image(x + 12, y + 10, icon).setOrigin(0, 0).setDisplaySize(28, 28));
      this.text(x + 46, y + 13, label, 17);
    };
    plate(x0, y0 + 30, "icon-health", `${e.hp}/${max}`);
    plate(x0 + 160, y0 + 30, "icon-defense", `${e.ward}`);

    // energy orbs, code-drawn
    this.layer.add(this.add.image(x0, y0 + 92, "icon-mana").setOrigin(0, 0).setDisplaySize(28, 28));
    for (let i = 0; i < CARDS_RULES.energy; i++) {
      const on = i < e.energy;
      const orb = this.add.circle(x0 + 56 + i * 34, y0 + 106, 12, on ? VIOLET : 0x141b24, on ? 1 : 0.9);
      orb.setStrokeStyle(2, on ? 0xe6ebf1 : 0x7d8a9a);
      this.layer.add(orb);
    }

    this.layer.add(this.add.nineslice(
      x0 + 160,
      y0 + 86,
      "deck-counter",
      undefined,
      148,
      50,
      36,
      36,
      31,
      24,
    ).setOrigin(0, 0));
    this.text(x0 + 160 + 74, y0 + 100, `Deck ${e.deckCount}`, 15).setOrigin(0.5, 0);

    // hand backs, fanned
    const n = e.handCount;
    const cw = 58;
    const ch = (456 / 320) * cw;
    const cx = x0 + 156;
    for (let i = 0; i < n; i++) {
      const x = cx + (i - (n - 1) / 2) * (cw * 0.6);
      this.layer.add(this.add.image(
        x,
        470,
        "card-back",
      ).setOrigin(0.5, 0).setDisplaySize(cw, ch).setAngle((i - (n - 1) / 2) * 3));
    }
    this.text(cx, 470 + ch + 6, `${n} in hand`, 13, "#A3AFBD", "500").setOrigin(0.5, 0);

    this.heroCard(e, isLeft, meta, max);

    // two summon slots, on the table art's own frames
    const spots = isLeft ? GameSlots.left : GameSlots.right;
    for (let slot = 0; slot < CARDS_RULES.summonSlots; slot++) {
      const [cx2, cy] = spots[slot];
      const u = e.units[slot];
      if (u) {
        const asleep = u.sleepUntil > p.turnId;
        const art = `summon:${summonArtName(u.kind)}`;
        const img = this.add.image(cx2, cy - 8, art).setDisplaySize(112, 112).setAlpha(asleep ? 0.45 : 1);
        this.layer.add(img);
        this.text(cx2, cy + 50, asleep ? `${u.power} · asleep` : `${u.power} / turn`, 14).setOrigin(0.5, 0);
      } else {
        this.text(cx2, cy, "Summon slot", 13, "#A3AFBD", "500").setOrigin(0.5);
      }
    }
  }
}

