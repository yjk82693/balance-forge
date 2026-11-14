import type { CardDef } from "./contract";

/**
 * Mirror of packages/games/cards/data.js (ids, costs, powers).
 * Used for labels, art and the mock only; the server stays authoritative.
 */
export const CARDS: CardDef[] = [
  { id: "spark", cost: 1, kind: "damage", power: 3, ignoresWard: false },
  { id: "ward", cost: 1, kind: "ward", power: 5, ignoresWard: false },
  { id: "sentinel", cost: 2, kind: "summon", power: 2, ignoresWard: false },
  { id: "hypnosis", cost: 2, kind: "hypnosis", power: 4, ignoresWard: true },
  { id: "pulse", cost: 1, kind: "damage", power: 2, ignoresWard: false },
];
export const CARDS_RULES = { energy: 3, handSize: 5, summonSlots: 2, rounds: 6, health: 20 };

const NAMES: Record<string, string> = {
  spark: "Spark",
  ward: "Ward",
  sentinel: "Sentinel",
  hypnosis: "Hypnosis",
  pulse: "Pulse",
};
export const cardName = (id: string) => NAMES[id] ?? id;

export function cardEffect(c: CardDef): string {
  switch (c.kind) {
    case "damage":
      return `${c.power} damage`;
    case "ward":
      return `${c.power} ward`;
    case "summon":
      return `Summon · ${c.power} per turn`;
    case "hypnosis":
      return `${c.power} damage · ignores ward · units sleep`;
  }
}

/** Card art in assets/hero_cards/cards: {hero}_{attack|guard|signature}.png */
export function cardArtPath(hero: string, c: CardDef): string {
  const variant = c.kind === "damage" ? "attack" : c.kind === "ward" ? "guard" : "signature";
  return `assets/hero_cards/cards/${hero}_${variant}.png`;
}

export const SUMMON_ART = "assets/hero_cards/summons/turret_drone.png";
