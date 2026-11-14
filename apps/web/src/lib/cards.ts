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
  { id: "mechanical_crows", cost: 2, kind: "summon", power: 2, ignoresWard: false },
  { id: "forethought", cost: 1, kind: "peek", power: 0, ignoresWard: false },
];
export const CARDS_RULES = { energy: 3, handSize: 5, summonSlots: 2, rounds: 6, health: 20 };

const NAMES: Record<string, string> = {
  spark: "Spark",
  ward: "Ward",
  sentinel: "Sentinel",
  hypnosis: "Hypnosis",
  pulse: "Pulse",
  mechanical_crows: "Mechanical Crows",
  forethought: "Forethought",
};

/** The standard deck, which is all the mock engine plays with (no peek, no crow deck). */
export const STANDARD_CARDS = CARDS.filter((c) => c.id !== "mechanical_crows" && c.kind !== "peek");
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
    case "peek":
      return "Peek at what comes next";
    default:
      return "";
  }
}

/** Cards with their own illustration, made for the card whoever plays it: cards/rules/<id>.png */
const RULES_ART = ["spark", "pulse", "sentinel", "hypnosis", "mechanical_crows", "forethought"];

/**
 * Card art: the card's own illustration (cards/rules/<id>) when it has one; ward keeps the hero's guard picture
 * (cards/<hero>_guard); anything else falls back to the hero's picture for its kind (attack, guard or signature).
 */
export function cardArtPath(hero: string, c: CardDef): string {
  if (RULES_ART.includes(c.id)) return `assets/hero_cards/cards/rules/${c.id}.png`;
  const variant = c.kind === "damage" ? "attack" : c.kind === "ward" ? "guard" : "signature";
  return `assets/hero_cards/cards/${hero}_${variant}.png`;
}

/**
 * Summon art by the card that made the unit. Only sentinel and mechanical_crows summon; the other summon pictures
 * (spirit_wisp, ink_screen, training_dummy) belong to no card in the rules.
 */
const SUMMON_NAME: Record<string, string> = { sentinel: "turret_drone", mechanical_crows: "crow_flock" };
export const SUMMON_ART_NAMES = ["turret_drone", "crow_flock"]; // the two pictures a card can use
export const summonArtName = (kind: string | undefined) => SUMMON_NAME[kind ?? ""] ?? "turret_drone";
export const summonArtPath = (name: string) => `assets/hero_cards/summons/${name}.png`;
export const SUMMON_ART = summonArtPath("turret_drone");

/** The effect of a played card in words, for the table. `dealt` is the damage the hit event reports. */
export function effectWords(c: CardDef, who: string, foe: string, dealt?: number): string {
  const name = cardName(c.id);
  switch (c.kind) {
    case "damage": {
      const absorbed = dealt !== undefined && dealt < c.power ? ` (${c.power - dealt} absorbed by ward)` : "";
      return `${name}: ${foe} takes ${dealt ?? c.power} damage${absorbed}`;
    }
    case "ward":
      return `${name}: ${who} gains ${c.power} ward`;
    case "summon":
      return `${name}: ${who} summons a unit that deals ${c.power} damage every turn`;
    case "hypnosis":
      return `${name}: ${foe} takes ${dealt ?? c.power} damage through ward, and ${foe}'s summons sleep next turn`;
    case "peek":
      return `${name}: ${who} looks at the top card of ${foe}'s deck`;
    default:
      return name;
  }
}

/**
 * A card change in words, "Pulse · cost" (the numbers follow): the server's label ("Pulse · Cost") with the field in
 * lower case. Any other path keeps its label unchanged.
 */
export function cardChangeLabel(path: string, label: string | undefined): string | undefined {
  if (!/^\/gameRules\/cards\/\d+\/(cost|power)$/.test(path) || !label) return label;
  const [name, field] = label.split(" · ");
  return field ? `${name} · ${field.toLowerCase()}` : label;
}
