export interface HeroInfo {
  id: string;
  name: string;
  cssVar: string;
}

// Hero identity colors: chips, portrait rings, legend swatches. Never bar fills.
export const HEROES: HeroInfo[] = [
  { id: "bari", name: "Bari", cssVar: "--hero-bari" },
  { id: "real_armor", name: "Real Armor", cssVar: "--hero-real-armor" },
  { id: "daewi", name: "Daewi", cssVar: "--hero-daewi" },
  { id: "sepia", name: "Sepia", cssVar: "--hero-sepia" },
  { id: "nightcrow", name: "Nightcrow", cssVar: "--hero-nightcrow" },
];

export function heroInfo(id: string | undefined): HeroInfo | undefined {
  return HEROES.find((h) => h.id === id);
}

export function heroName(id: string | undefined): string {
  return heroInfo(id)?.name ?? (id ? id.replace(/_/g, " ") : "Unknown");
}

export function heroColorVar(id: string | undefined): string {
  return `var(${heroInfo(id)?.cssVar ?? "--line-strong"})`;
}

// Hex values for Phaser (dark theme tokens; the canvas always uses the dark set).
export const HERO_HEX: Record<string, number> = {
  bari: 0x2ec4b6,
  real_armor: 0xff8a3d,
  daewi: 0xa3b65e,
  sepia: 0xb08af0,
  nightcrow: 0xf0525a,
};
