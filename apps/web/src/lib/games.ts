import { TENTACLE_RUN_ENABLED } from "./featureFlags";

export type GameStatus = "ready" | "planned";

export interface GameInfo {
  id: string;
  title: string;
  eyebrow: string;
  accentVar: string;
  summary: string;
  art: string;
  portraitHero: string;
  status: GameStatus;
}

export const GAMES: GameInfo[] = [
  {
    id: "hero_arena",
    title: "Hero Arena",
    eyebrow: "HERO ARENA",
    accentVar: "--game-arena",
    summary: "5 heroes · real-time",
    art: "assets/hero_arena/backgrounds/arena_floor.png",
    portraitHero: "bari",
    status: "ready",
  },
  {
    id: "hero_cards",
    title: "Hero Cards",
    eyebrow: "HERO CARDS",
    accentVar: "--game-cards",
    summary: "deck duel · turn-based",
    art: "assets/hero_cards/backgrounds/table.png",
    portraitHero: "daewi",
    status: "ready",
  },
  {
    id: "tentacle_run",
    title: "Sepia Tentacle Run",
    eyebrow: "TENTACLE RUN",
    accentVar: "--game-sepia",
    summary: "solo run · 5 waves and a boss",
    art: "assets/sepia_tentacle_run/backgrounds/rooftop.png",
    portraitHero: "sepia",
    status: TENTACLE_RUN_ENABLED ? "ready" : "planned",
  },
];

export const gameById = (id: string | undefined) => GAMES.find((g) => g.id === id);
