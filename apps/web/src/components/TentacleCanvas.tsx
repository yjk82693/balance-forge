import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import { assetUrl, heroThumbPath, loadManifest, preferWebp } from "../lib/assets";
import type { TentaclePayload } from "../lib/tentacle";
import { TENT_H, TENT_W, TentacleScene, type TentacleAssets } from "./TentacleScene";

/** The Sepia Tentacle Run view of a match: Phaser on the rooftop, fed Observations. */
export function TentacleCanvas({ observation }: { observation: Observation<TentaclePayload> | null }) {
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
      const assets: TentacleAssets = {
        rooftop: assetUrl(preferWebp(`${base}/backgrounds/rooftop.png`)),
        post: assetUrl(`${base}/sprites/anchor_post.png`),
        postTarget: assetUrl(`${base}/sprites/anchor_post_target.png`),
        segment: assetUrl(`${base}/sprites/tentacle_segment.png`),
        walker: assetUrl(`${base}/enemies/walker.png`),
        drone: assetUrl(`${base}/enemies/drone.png`),
        sentry: assetUrl(`${base}/enemies/sentry.png`),
        playerTrack: u("player_health_track"),
        playerFill: u("player_health_fill"),
        sharkTrack: u("man_shark_health_track"),
        sharkFill: u("man_shark_health_fill"),
        sharkPortrait: u("man_shark_portrait"),
        sharkName: u("man_shark_nameplate"),
        sharkWarning: u("man_shark_warning_banner"),
        pipOn: u("man_shark_phase_pip_active"),
        pipOff: u("man_shark_phase_pip_empty"),
        sepia: assetUrl(heroThumbPath("sepia")),
      };
      game.current = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: TENT_W,
        height: TENT_H,
        backgroundColor: "#0D1219",
        scale: { mode: Phaser.Scale.NONE },
        scene: TentacleScene,
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

  return <div ref={host} className="arena-host" role="img" aria-label="Sepia Tentacle Run rooftop view" />;
}
