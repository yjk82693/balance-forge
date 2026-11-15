import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import { assetUrl, heroThumbPath, loadManifest, preferWebp } from "../lib/assets";
import type { RunnerPayload } from "../lib/runner";
import { RUN_H, RUN_W, RunnerScene, type RunnerAssets } from "./RunnerScene";

/** The Sepia Tentacle Run view of a match: Phaser on the rooftop, fed Observations. */
export function RunnerCanvas({ observation }: { observation: Observation<RunnerPayload> | null }) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const latest = useRef(observation);
  latest.current = observation;

  useEffect(() => {
    let cancelled = false;
    loadManifest().then(() => {
      if (cancelled || !host.current) return;
      const base = "assets/sepia_tentacle_run";
      const u = (f: string) => assetUrl(`${base}/ui/${f}.png`);
      const assets: RunnerAssets = {
        rooftop: assetUrl(preferWebp(`${base}/backgrounds/rooftop.png`)),
        post: assetUrl(`${base}/sprites/anchor_post.png`),
        postTarget: assetUrl(`${base}/sprites/anchor_post_target.png`),
        segment: assetUrl(`${base}/sprites/tentacle_segment.png`),
        sharkPortrait: u("man_shark_portrait"),
        sepia: assetUrl(heroThumbPath("sepia")),
      };
      game.current = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: RUN_W,
        height: RUN_H,
        backgroundColor: "#0D1219",
        scale: { mode: Phaser.Scale.NONE },
        scene: RunnerScene,
        audio: { noAudio: true },
        banner: false,
        callbacks: {
          preBoot: (gm) => {
            gm.registry.set("assets", assets);
            if (latest.current) gm.registry.set("obs", latest.current);
          },
        },
      });
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

  return <div ref={host} className="arena-host" role="img" aria-label="Sepia Tentacle Run side view" />;
}
