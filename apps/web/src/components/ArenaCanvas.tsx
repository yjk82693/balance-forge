import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { GameEvent, Observation } from "../lib/contract";
import type { ViewPacket } from "../mock/useRoom";
import { assetUrl, loadManifest, manifestUrl, heroFullBodyPath } from "../lib/assets";
import { HEROES } from "../lib/heroes";
import { SnapshotBuffer } from "../lib/snapshotBuffer";
import { ARENA_H, ARENA_W, ArenaScene, type ArenaAssets } from "./ArenaScene";

const debug = () => new URLSearchParams(location.search).get("debug") === "1";

const EFFECTS = [
  "spirit_arrow",
  "blaster_burst",
  "crow_dive",
  "hypnosis_ripple",
  "tentacle_lash",
  "blade_slash",
  "shield_bubble",
  "hit_spark",
];

/** Phaser canvas for Hero Arena. Pass the newest Observation; the scene redraws from it. */
export function ArenaCanvas({
  observation,
  events,
  compact = false,
  views,
  smooth = !compact,
}: {
  observation: Observation | null;
  events?: GameEvent[];
  compact?: boolean;
  /** subscribe to every state.view as it arrives (not only the newest per render); see useRoom */
  views?: (fn: (v: ViewPacket) => void) => () => void;
  /** snapshot interpolation for live matches; the replay side-by-side keeps its own frame clock */
  smooth?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const buffer = useRef<SnapshotBuffer | null>(null);
  if (smooth && !buffer.current) buffer.current = new SnapshotBuffer();
  const latest = useRef<Observation | null>(observation);
  latest.current = observation;

  useEffect(() => {
    let cancelled = false;
    loadManifest().then(() => {
      if (cancelled || !host.current) return;
      const heroes: Record<string, string> = {};
      for (const h of HEROES) heroes[h.id] = manifestUrl(heroFullBodyPath(h.id)) ?? assetUrl(heroFullBodyPath(h.id));
      const assets: ArenaAssets = {
        floor: assetUrl("assets/hero_arena/backgrounds/arena_floor.png"),
        heroes,
        effects: Object.fromEntries(EFFECTS.map((k) => [k, assetUrl(`assets/hero_arena/effects/${k}.png`)])),
        hpTrack: assetUrl("assets/hero_arena/ui/player_health_track.png"),
        hpFill: assetUrl("assets/hero_arena/ui/player_health_fill.png"),
      };
      const g = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: compact ? 768 : ARENA_W,
        height: compact ? 432 : ARENA_H,
        backgroundColor: "#0D1219",
        scale: { mode: Phaser.Scale.NONE },
        scene: ArenaScene,
        audio: { noAudio: true },
        banner: false,
        callbacks: {
          preBoot: (gm) => {
            gm.registry.set("assets", assets);
            gm.registry.set("k", compact ? 768 / ARENA_W : 1);
            if (latest.current) gm.registry.set("obs", latest.current);
            if (buffer.current) gm.registry.set("feed", buffer.current);
            gm.registry.set("debug", debug());
          },
        },
      });
      game.current = g;
    });
    return () => {
      cancelled = true;
      game.current?.destroy(true);
      game.current = null;
    };
  }, [compact]);

  // Live matches: every packet goes into the snapshot buffer (the buffer ignores a tick it already has).
  useEffect(() => {
    const buf = buffer.current;
    if (!buf || !views) return;
    return views((v) => {
      buf.push({ tick: v.observation.tick, observation: v.observation, events: v.events }, performance.now());
    });
  }, [views]);
  useEffect(() => {
    if (buffer.current && observation) {
      buffer.current.push({ tick: observation.tick, observation, events }, performance.now());
    }
    // Events first: the scene reads them when the matching observation arrives.
    game.current?.registry.set("events", events);
    if (observation) game.current?.registry.set("obs", observation);
  }, [observation, events]);

  return <div ref={host} className="arena-host" role="img" aria-label="Hero Arena match view" />;
}
