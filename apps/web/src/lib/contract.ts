// Wire types mirrored from spec/contract-v0.1.md (read-only copy; the spec stays the source of truth).
export interface ActionInput {
  playerId: string;
  seq: number;
  tick: number;
  turnId: number;
  actionId: string;
  params: Record<string, number>;
}

export interface MatchConfig {
  contractVersion: "0.1";
  schemaVersion: 1;
  gameId: string;
  simVersion: string;
  dataHash: string;
  seed: number;
  players: string[];
  mode: "realtime" | "turn" | "party";
  maxTicks: number;
}

export interface Outcome {
  status: "running" | "win" | "draw";
  winners: string[];
  reason: string;
}

export interface Statistics {
  players: {
    playerId: string;
    wins: number;
    draws: number;
    damage: number;
    actions: { actionId: string; opportunities: number; uses: number }[];
  }[];
  durationTicks: number;
}

export interface MatchResult {
  matchId: string;
  config: MatchConfig;
  outcome: Outcome;
  statistics: Statistics;
  finalStateHash: string;
  valid: boolean;
  errorCode: string;
}

export interface ReportRow {
  dimension: string;
  wins: number;
  games: number;
  winRate: number;
  ci95: [number, number];
  uses: number;
  opportunities: number;
  outlier: boolean;
}

export interface Report {
  reportId: string;
  gameId: string;
  simVersion: string;
  dataHash: string;
  botPolicyVersion: string;
  seedSetId: string;
  validMatches: number;
  invalidMatches: number;
  draws: number;
  rows: ReportRow[];
  /** v0.1.1 addendum (all optional) */
  elapsedMs?: number;
  recorded?: boolean;
  createdAt?: string;
  humanMatches?: number;
}

export interface PatchProposal {
  baseDataHash: string;
  replacements: { path: string; value: number }[];
  rationale: string;
}

export interface ArenaEntity {
  id: string;
  hero: string;
  x: number;
  y: number;
  hp: number;
  /** v0.1.1 addendum: optional; the UI falls back to 100 when absent. */
  maxHp?: number;
  facing: number;
}

export interface ArenaProjectile {
  id: string;
  owner: string;
  kind: string;
  x: number;
  y: number;
}

export interface ArenaPayload {
  arena: { w: number; h: number };
  entities: ArenaEntity[];
  projectiles: ArenaProjectile[];
}

export interface Observation<P = ArenaPayload> {
  tick: number;
  viewerId: string;
  payload: P;
}

export interface Envelope<P = unknown> {
  protocolVersion: "0.1";
  type: string;
  roomId: string;
  sessionId: string;
  requestId: string;
  seq: number;
  epoch: number;
  payload: P;
}

export interface Seat {
  seat: string;
  name: string;
  connected: boolean;
  /** Extension (see CHANGE_REQUEST.md): hero chosen on the phone. */
  hero?: string;
}

export interface RoomStatusPayload {
  joinCode: string;
  phase: "lobby" | "playing" | "ended";
  seats: Seat[];
  /** Extension: set only on the reply addressed to a joining controller. */
  you?: string;
  /** Not in the addendum: lets a phone know which controller to show. See REPORT.md. */
  gameId?: string;
}

export interface CardDef {
  id: string;
  cost: number;
  kind: "damage" | "ward" | "summon" | "hypnosis";
  power: number;
  ignoresWard: boolean;
}

export interface CardsEntity {
  id: string;
  hp: number;
  maxHp?: number;
  energy: number;
  ward: number;
  handCount: number;
  deckCount: number;
  units: { id: string; power: number; sleepUntil: number }[];
}

/** hero_cards observation payload (packages/games/cards/schemas.js). `hand` is only the viewer's. */
export interface CardsPayload {
  activePlayer: string;
  round: number;
  turnId: number;
  entities: CardsEntity[];
  hand: CardDef[];
  outcome: Outcome;
}

export const isArenaPayload = (p: unknown): p is ArenaPayload =>
  !!p && typeof p === "object" && "arena" in p && "entities" in p;
export const isCardsPayload = (p: unknown): p is CardsPayload =>
  !!p && typeof p === "object" && "hand" in p && "activePlayer" in p;
