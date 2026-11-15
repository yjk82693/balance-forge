import type { Observation } from "./contract";
import type { RunnerAnchor, RunnerObstacle, RunnerPayload } from "./runner";

// Development only (`npm run dev`, #/arena/tentacle_run?stub=1): a made-up run to look at the scene without the engine.
// Never part of a production build and never shown as a result.

const FINISH = 480000;
const ob = (id: string, kind: RunnerObstacle["kind"], x: number, w: number, y: number, h: number): RunnerObstacle => ({
  id, kind, x, w, y, h, section: 1 + Math.floor(x / 80000),
});
const OBSTACLES: RunnerObstacle[] = [
  ob("p1", "pit", 24000, 6000, 0, 0),
  ob("w1", "wall", 42000, 1200, 0, 3000),
  ob("b1", "lowBar", 58000, 5000, 800, 2200),
  ob("p2", "pit", 84000, 9000, 0, 0),
  ob("w2", "wall", 112000, 1200, 0, 3600),
  ob("b2", "lowBar", 130000, 6000, 800, 2200),
  ob("p3", "pit", 156000, 11000, 0, 0), ob("p4", "pit", 200000, 12000, 0, 0), ob("w3", "wall", 230000, 1200, 0, 4000),
];
const ANCHORS: RunnerAnchor[] = [8, 29, 90, 160, 205].map((k, i) => ({
  id: `a${i}`,
  x: k * 1000 + 3000,
  y: 5000,
  section: 1,
}));

export function stubObservation(tick: number): Observation<RunnerPayload> {
  const x = 4000 + ((tick * 120) % (FINISH - 8000));
  const anchor = ANCHORS.find((a) => x > a.x - 2500 && x < a.x + 2500);
  const swinging = !!anchor;
  const jumping = !swinging && Math.floor(tick / 40) % 7 === 0;
  const y = swinging ? 3500 + Math.sin(tick / 20) * 1500 : jumping ? 400 + Math.abs(Math.sin(tick / 12)) * 2600 : 0;
  const sliding = !swinging && !jumping && Math.floor(tick / 50) % 9 === 4;
  const cameraX = Math.max(0, x - 4000);
  const section = Math.min(6, 1 + Math.floor(x / 80000));
  return {
    tick,
    viewerId: "p1",
    payload: {
      section, sectionCount: 6, sectionStartX: (section - 1) * 80000, sectionEndX: section * 80000,
      cameraX, viewWidth: 16000, finishX: FINISH,
      player: {
        x, y, vx: 220, vy: 0, state: swinging ? "swinging" : jumping ? "jumping" : sliding ? "sliding" : "running",
        height: sliding ? 500 : 1200, jumpHeldTicks: 0,
        wire: swinging && anchor ? { anchorId: anchor.id, anchorX: anchor.x, anchorY: anchor.y, length: 4000 } : null,
      },
      obstacles: OBSTACLES, anchors: ANCHORS,
      shark: section === 6 ? { x: x - 7000 } : null,
      outcome: { status: "running", winners: [], reason: "" },
    },
  };
}
