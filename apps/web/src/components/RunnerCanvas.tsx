import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { Observation } from "../lib/contract";
import { assetUrl, heroThumbPath, loadManifest, preferWebp } from "../lib/assets";
import { DEFAULT_META, RUNNER_SLOTS, probeSlot, slotPath, type RunnerMeta } from "../lib/runnerArt";
import type { RunnerPayload } from "../lib/runner";
import { RUN_H, RUN_W, RunnerScene, type RunnerAssets } from "./RunnerScene";

/** The slot files that exist (each probed once), and meta.json of the slicer when there is one. */
async function loadArt(): Promise<{ art: Record<string, string>; meta: RunnerMeta }> {
  const probe = async (s: string) => [s, await probeSlot(s, assetUrl(slotPath(s)))] as const;
  const found = await Promise.all(RUNNER_SLOTS.map(probe));
  const art = Object.fromEntries(found.filter((f): f is readonly [string, string] => !!f[1]));
  let meta = DEFAULT_META;
  try {
    const res = await fetch(assetUrl("assets/sepia_tentacle_run/runner/meta.json"));
    const m = res.ok ? ((await res.json()) as Partial<RunnerMeta>) : {};
    meta = { ...DEFAULT_META, ...m };
  } catch {
    /* no meta: the defaults of the GPT sheet spec */
  }
  return { art, meta };
}

/** The Sepia Tentacle Run side view: Phaser, fed Observations; the art slots that exist replace the drawn ones. */
export function RunnerCanvas({
  observation,
  names,
}: {
  observation: Observation<RunnerPayload> | null;
  /** seat id to the name typed on the phone, for a versus match */
  names?: Record<string, string>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const latest = useRef(observation);
  latest.current = observation;
  const namesNow = useRef(names);
  namesNow.current = names;

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadManifest(), loadArt()]).then(([, { art, meta }]) => {
      if (cancelled || !host.current) return;
      const base = "assets/sepia_tentacle_run";
      const assets: RunnerAssets = {
        rooftop: assetUrl(preferWebp(`${base}/backgrounds/rooftop.png`)),
        post: assetUrl(`${base}/sprites/anchor_post.webp`),
        postTarget: assetUrl(`${base}/sprites/anchor_post_target.webp`),
        segment: assetUrl(`${base}/sprites/tentacle_segment.webp`),
        sharkPortrait: assetUrl(`${base}/ui/man_shark_portrait.webp`),
        sepia: assetUrl(heroThumbPath("sepia")),
        art,
        meta,
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
            gm.registry.set("names", namesNow.current);
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
    game.current?.registry.set("names", names);
    if (observation) game.current?.registry.set("obs", observation);
  }, [observation, names]);

  return <div ref={host} className="arena-host" role="img" aria-label="Sepia Tentacle Run side view" />;
}
