import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import { assetUrl, loadManifest, manifestUrl, heroFullBodyPath } from "../lib/assets";
import { HEROES } from "../lib/heroes";
import { ARENA_H, ARENA_W, ArenaScene, type ArenaAssets } from "./ArenaScene";

/** Phaser canvas for Hero Arena. Pass the newest Observation; the scene redraws from it. */
export function ArenaCanvas({ observation }: { observation: Observation | null }) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
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
        arrow: assetUrl("assets/hero_arena/effects/spirit_arrow.png"),
        hpTrack: assetUrl("assets/hero_arena/ui/player_health_track.png"),
        hpFill: assetUrl("assets/hero_arena/ui/player_health_fill.png"),
      };
      const g = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: ARENA_W,
        height: ARENA_H,
        backgroundColor: "#0D1219",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: ArenaScene,
        audio: { noAudio: true },
        banner: false,
        callbacks: {
          preBoot: (gm) => {
            gm.registry.set("assets", assets);
            if (latest.current) gm.registry.set("obs", latest.current);
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
  }, []);

  useEffect(() => {
    if (observation) game.current?.registry.set("obs", observation);
  }, [observation]);

  return <div ref={host} className="arena-host" role="img" aria-label="Hero Arena match view" />;
}
