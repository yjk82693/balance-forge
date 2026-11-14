import type { Observation } from "./contract";
import { ARENA, type TentacleEntity, type TentaclePayload, type TentaclePost } from "./tentacle";

// Development only (`npm run dev`, #/arena/tentacle_run?stub=1): a made-up run to look at the scene without the engine.
// Never part of a production build and never shown as a result.

const POSTS: TentaclePost[] = Array.from({ length: 15 }, (_, i) => ({
  id: i,
  x: 1600 + (i % 5) * 3200,
  y: 1500 + Math.floor(i / 5) * 3000,
}));

export function stubObservation(tick: number): Observation<TentaclePayload> {
  const t = tick / 60;
  const wave = 1 + (Math.floor(t / 6) % 6);
  const boss = wave === 6;
  const latched = Math.floor(t / 2) % 2 === 0;
  const post = POSTS[(Math.floor(t / 2) * 4) % 15];
  const player: TentacleEntity = {
    id: "p1", kind: "player", x: 8000 + Math.cos(t) * 2500, y: 4500 + Math.sin(t * 1.3) * 1800,
    hp: Math.max(10, 100 - Math.floor(t * 3) % 90), maxHp: 100,
    latch: latched ? { post: post.id, untilTick: tick + 30 } : null,
  };
  const foes: TentacleEntity[] = [];
  const kinds = ["walker", "drone", "sentry"] as const;
  for (let i = 0; i < (boss ? 3 : 2 + wave); i++) {
    const kind = kinds[i % 3];
    foes.push({
      id: `e${i}`, kind, x: ARENA.w * (0.15 + 0.7 * ((i * 0.37 + t * 0.03 * (kind === "sentry" ? 0 : 1)) % 1)),
      y: 1200 + (i * 1700) % 6800, hp: 20 - (i % 3) * 5, maxHp: 20,
    });
  }
  if (boss) foes.push({ id: "boss", kind: "boss", x: 11500, y: 4500, hp: 700, maxHp: 1000 });
  return {
    tick, viewerId: "p1",
    payload: {
      wave, waveCount: 5, waveTick: tick % 360, entities: [player, ...foes], posts: POSTS,
      projectiles: [{ id: "s1", x: 5000 + ((tick * 40) % 6000), y: 3000, from: "drone" }],
      boss: boss ? { hp: 700, maxHp: 1000, phase: 1, phases: 3 } : null,
      outcome: { status: "running", winners: [], reason: "" },
    },
  };
}
