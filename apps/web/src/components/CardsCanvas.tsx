import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { CardsPayload, Observation } from "../lib/contract";
import { assetUrl, loadManifest, preferWebp } from "../lib/assets";
import { SUMMON_ART } from "../lib/cards";
import { CardsScene, TABLE_H, TABLE_W, type CardsAssets, type CardsMeta } from "./CardsScene";

interface Props {
  observation: Observation<CardsPayload> | null;
  names: Record<string, string>;
}

export function CardsCanvas({ observation, names }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const latest = useRef({ observation, names });
  latest.current = { observation, names };

  useEffect(() => {
    let cancelled = false;
    loadManifest().then(() => {
      if (cancelled || !host.current) return;
      const u = (f: string) => assetUrl(`assets/hero_cards/ui/${f}.png`);
      const assets: CardsAssets = {
        table: assetUrl(preferWebp("assets/hero_cards/backgrounds/table.png")),
        cardBack: u("card_back"),
        hudSlot: u("hud_slot"),
        deckCounter: u("deck_counter"),
        turnBanner: u("turn_banner"),
        iconHealth: u("icon_health"),
        iconDefense: u("icon_defense"),
        iconMana: u("icon_mana"),
        summon: assetUrl(SUMMON_ART),
      };
      game.current = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: TABLE_W,
        height: TABLE_H,
        backgroundColor: "#0D1219",
        scale: { mode: Phaser.Scale.NONE },
        scene: CardsScene,
        audio: { noAudio: true },
        banner: false,
        callbacks: {
          preBoot: (gm) => {
            gm.registry.set("assets", assets);
            gm.registry.set("meta", { names: latest.current.names } satisfies CardsMeta);
            if (latest.current.observation) gm.registry.set("obs", latest.current.observation);
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
    game.current?.registry.set("meta", { names } satisfies CardsMeta);
    if (observation) game.current?.registry.set("obs", observation);
  }, [observation, names]);

  return <div ref={host} className="arena-host" role="img" aria-label="Hero Cards table view" />;
}
