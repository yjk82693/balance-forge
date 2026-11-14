import Phaser from "phaser";

/** Hit-stop length in milliseconds by hit weight (tier 1..3): 3, 4 and 5 frames at 60 Hz. */
const HIT_STOP_MS = [0, 50, 67, 83];
/** After a hit-stop the sprites ease back to where the match is, instead of jumping there. */
const CATCH_UP_MS = 120;
const KNOCK_DECAY_MS = 90;
/** How far a hero leans forward into an attack. */
const LUNGE_PX = 12;
const LEAN_EASE_MS = 40;
const LEAN_RELEASE_MS = 110;
const LEAN_MAX_HOLD_MS = 220;
const POSE_MS = { attack: 260, hit: 200 };
const PARTICLES = [0, 6, 10, 16];
export const PARTICLE_TEXTURE = "feel-px";

export type PoseName = "attack" | "hit" | "ko";
export const poseKey = (hero: string, pose: PoseName) => `pose:${hero}:${pose}`;

interface Feel {
  knock: number; // pixels, signed: the push away from the other hero, decaying
  lean: number; // 0..1
  leanHold: number; // ms left that the lean is held (waiting for the attack to land)
  pose?: { name: PoseName; ms: number };
}

/**
 * Procedural hit feel, all cosmetic and driven by events: hit-stop, knockback, a lean before an attack, particles and
 * optional still poses per hero. Nothing here is state; with prefers-reduced-motion only the poses remain.
 */
export class HitFeel {
  private feel = new Map<string, Feel>();
  private stopMs = 0;
  private catchMs = 0;

  constructor(
    private scene: Phaser.Scene,
    private k: number,
    private reduce: boolean,
  ) {}

  private of(id: string): Feel {
    let f = this.feel.get(id);
    if (!f) this.feel.set(id, (f = { knock: 0, lean: 0, leanHold: 0 }));
    return f;
  }

  private hasPose(hero: string, name: PoseName) {
    return this.scene.textures.exists(poseKey(hero, name));
  }

  /** The target was hit by something coming from `awayDir` (+1: push to the right, -1: to the left). */
  hit(id: string, hero: string, tier: 1 | 2 | 3, awayDir: number, at: { x: number; y: number }, color: number) {
    if (this.hasPose(hero, "hit")) this.of(id).pose = { name: "hit", ms: POSE_MS.hit };
    if (this.reduce) return;
    this.stopMs = Math.max(this.stopMs, HIT_STOP_MS[tier]);
    this.catchMs = CATCH_UP_MS;
    this.of(id).knock = awayDir * (6 + tier * 5) * this.k;
    this.burst(at.x, at.y, awayDir, PARTICLES[tier], color);
  }

  ko(id: string, hero: string) {
    if (this.hasPose(hero, "ko")) this.of(id).pose = { name: "ko", ms: Infinity };
  }

  revive(id: string) {
    const f = this.of(id);
    if (f.pose?.name === "ko") f.pose = undefined;
  }

  /** Lunge forward now and hold it until the attack lands (`attack`), at most a moment. */
  anticipate(id: string) {
    if (this.reduce) return;
    this.of(id).leanHold = LEAN_MAX_HOLD_MS;
  }

  /** The attack has happened: let the lean go, and show the attack pose if the hero has one. */
  attack(id: string, hero: string) {
    const f = this.of(id);
    if (this.hasPose(hero, "attack")) f.pose = { name: "attack", ms: POSE_MS.attack };
    if (this.reduce) return;
    f.leanHold = f.lean > 0.05 ? 0 : 60; // no lookahead (replay views): a short lean pulse instead
  }

  /** Texture key of the pose to show for this hero right now, if one is active. */
  pose(id: string, hero: string): string | undefined {
    const name = this.feel.get(id)?.pose?.name;
    return name && this.hasPose(hero, name) ? poseKey(hero, name) : undefined;
  }

  /** Sprite offset and tilt: knockback pixels, plus the lunge forward in the facing direction (+1 right, -1 left). */
  offset(id: string, facing: number): { x: number; angle: number } {
    const f = this.feel.get(id);
    if (!f) return { x: 0, angle: 0 };
    return { x: f.knock + f.lean * LUNGE_PX * this.k * facing, angle: f.lean * 6 * facing };
  }

  /** Advance the timers; true while the world should hold still (hit-stop). */
  step(deltaMs: number): boolean {
    const stopped = this.stopMs > 0;
    if (stopped) this.stopMs = Math.max(0, this.stopMs - deltaMs);
    else this.catchMs = Math.max(0, this.catchMs - deltaMs);
    for (const f of this.feel.values()) {
      f.knock *= Math.exp(-deltaMs / KNOCK_DECAY_MS);
      if (Math.abs(f.knock) < 0.1) f.knock = 0;
      f.leanHold = Math.max(0, f.leanHold - deltaMs);
      const up = f.leanHold > 0;
      f.lean += ((up ? 1 : 0) - f.lean) * (1 - Math.exp(-deltaMs / (up ? LEAN_EASE_MS : LEAN_RELEASE_MS)));
      if (f.pose) f.pose.ms -= deltaMs;
      if (f.pose && f.pose.ms <= 0) f.pose = undefined;
    }
    return stopped;
  }

  /** How much of the way to the true position to move this frame: 1 normally, less right after a hit-stop. */
  followRate(deltaMs: number): number {
    return this.catchMs > 0 ? 1 - Math.exp(-deltaMs / 40) : 1;
  }

  private burst(x: number, y: number, awayDir: number, count: number, color: number) {
    if (!this.scene.textures.exists(PARTICLE_TEXTURE)) return;
    const k = this.k;
    const centre = awayDir > 0 ? 0 : 180;
    const emitter = this.scene.add.particles(x, y, PARTICLE_TEXTURE, {
      speed: { min: 80 * k, max: 240 * k },
      angle: { min: centre - 55, max: centre + 55 },
      lifespan: 360,
      scale: { start: 1.1 * k, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffffff, color],
      emitting: false,
    });
    emitter.setDepth(9100);
    emitter.explode(count);
    this.scene.time.delayedCall(500, () => emitter.destroy());
  }
}
