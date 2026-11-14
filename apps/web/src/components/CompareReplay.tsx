import { useEffect, useState } from "react";
import { ArenaCanvas } from "./ArenaCanvas";
import { FRAME_MS, eventsAt, frameAt, type Version } from "../lib/replayGen";
import { heroName } from "../lib/heroes";
import type { ReplayFrame, ReplaySource } from "../lib/replaySource";

interface Props {
  seed: number;
  heroes: [string, string];
  /** which side is highlighted as "the data currently selected" */
  active: Version;
  /** frames from the server or the analysis; without it the view plays an illustrative replay */
  source: ReplaySource | null;
  /** matchId of a stored replay the seed came from, when the server provided one */
  storedMatchId?: string;
}

const SIDES: { v: Version; label: string }[] = [
  { v: "broken", label: "Broken data" },
  { v: "patched", label: "Patched data" },
];

/** What the footnote says about the frames: where they come from, and when they are not real. */
function footnote(source: ReplaySource | null, seed: number, storedMatchId?: string): string {
  if (source?.kind === "views") {
    return "Replay of the same match on both data versions, from the server's recorded views.";
  }
  if (source?.kind === "timeline") {
    return "HP from the analysis timeline for the same seed. Positions were not recorded, so the heroes stand still.";
  }
  const stored = storedMatchId
    ? " Seed from a stored replay; the frames are illustrative because the server has no views for it yet."
    : " Illustrative replay, not a recorded match.";
  return `Same seed ${seed}.${stored}`;
}

function frameFor(side: Version, i: number, source: ReplaySource | null, seed: number, heroes: [string, string]) {
  if (source?.kind === "views" || source?.kind === "timeline") {
    const list: ReplayFrame[] = source.kind === "views" ? source[side] : source.frames[side];
    return list[i % list.length];
  }
  return { observation: frameAt(i, side, seed, heroes), events: eventsAt(i, side, seed, heroes) } as ReplayFrame;
}

/** Two Phaser arenas, one frame clock: broken data on the left, patched data on the right. */
export function CompareReplay({ seed, heroes, active, source, storedMatchId }: Props) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // shows frame 0; no autoplay
    const t = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="replays" aria-label="Same match, broken data and patched data">
      {SIDES.map(({ v, label }) => {
        const { observation, events } = frameFor(v, frame, source, seed, heroes);
        const [p1, p2] = observation.payload.entities;
        return (
          <figure key={v} className={`replay${active === v ? " on" : ""}`}>
            <div className="replay-stage">
              <ArenaCanvas observation={observation} events={events} compact />
            </div>
            <figcaption>
              <span className={`badge ${v === "broken" ? "before" : "after"}`}>{label}</span>
              <span className="caption">
                {heroName(p1.hero)} {p1.hp} · {heroName(p2.hero)} {p2.hp}
              </span>
            </figcaption>
          </figure>
        );
      })}
      <p className="caption replay-note">{footnote(source, seed, storedMatchId)}</p>
    </section>
  );
}
