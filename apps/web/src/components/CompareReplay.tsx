import { useEffect, useState } from "react";
import { ArenaCanvas } from "./ArenaCanvas";
import { FRAME_MS, frameAt, type Version } from "../lib/replayGen";
import { heroName } from "../lib/heroes";

interface Props {
  seed: number;
  heroes: [string, string];
  /** which side is highlighted as "the data currently selected" */
  active: Version;
  sample: boolean;
  /** matchId of a stored replay the seed came from, when the server provided one */
  storedMatchId?: string;
}

/** Two Phaser arenas, same seed, one frame clock: broken data on the left, patched data on the right. */
export function CompareReplay({ seed, heroes, active, sample, storedMatchId }: Props) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // shows frame 0; no autoplay
    const t = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(t);
  }, []);
  const sides: { v: Version; label: string }[] = [
    { v: "broken", label: "Broken data" },
    { v: "patched", label: "Patched data" },
  ];
  return (
    <section className="replays" aria-label="Same match, broken data and patched data">
      {sides.map(({ v, label }) => {
        const obs = frameAt(frame, v, seed, heroes);
        const [p1, p2] = obs.payload.entities;
        return (
          <figure key={v} className={`replay${active === v ? " on" : ""}`}>
            <div className="replay-stage">
              <ArenaCanvas observation={obs} compact />
            </div>
            <figcaption>
              <span className={`badge ${v === "broken" ? "before" : "after"}`}>{label}</span>
              <span className="caption">
                {heroName(heroes[0])} {p1.hp} · {heroName(heroes[1])} {p2.hp}
              </span>
            </figcaption>
          </figure>
        );
      })}
      <p className="caption replay-note">
        Same seed {seed}.{" "}
        {storedMatchId
          ? "Seed from a stored replay; the frames are illustrative because the server stores inputs, not views."
          : sample
            ? "Illustrative replay (mock), not a recorded match."
            : "Replay of the same seed on both data versions."}
      </p>
    </section>
  );
}
