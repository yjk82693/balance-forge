// Wire types derived from the normative v0.1 schema.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
// A JSON schema fragment as the validator and the schema file use it (only the keywords they implement).
export type SchemaNode = {
  type?: string; $ref?: string; anyOf?: SchemaNode[]; oneOf?: SchemaNode[]; const?: Json; enum?: Json[];
  minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number; minItems?: number;
  maxItems?: number; uniqueItems?: boolean; items?: SchemaNode; minProperties?: number; maxProperties?: number;
  required?: string[]; properties?: Record<string, SchemaNode>; additionalProperties?: boolean | SchemaNode;
  propertyNames?: SchemaNode; [keyword: string]: unknown;
};
export type ActionInput = {
  "playerId": string;
  "seq": number;
  "tick": number;
  "turnId": number;
  "actionId": string;
  "params": Record<string, any>; // validated against the action's paramsSchema
};
export type InputFrame = {
  "tick": number;
  "actions": Array<ActionInput>;
  "systemInputs": Array<{
    "kind": "system.timeout";
    "playerId": string;
    "turnId": number;
  }>;
};
export type MatchConfig = {
  "contractVersion": "0.1";
  "schemaVersion": 1;
  "gameId": string;
  "simVersion": string;
  "dataHash": string;
  "seed": number;
  "players": Array<string>;
  "mode": "realtime" | "turn" | "party";
  "maxTicks": number;
  "options"?: {
    assignments: Record<string, string>;
  };
};
export type State = {
  "tick": number;
  "rng": number;
  "turnId": number;
  "payload": Record<string, any>; // per game
};
export type Observation = {
  "tick": number;
  "viewerId": string;
  "payload": Record<string, any>; // per game
};
export type Outcome = {
  "status": "running" | "win" | "draw";
  "winners": Array<string>;
  "reason": string;
};
export type ActionSpec = {
  "actionId": string;
  "labelKey": string;
  "control": string; // "button" | "axes" | "choice"
  "paramsSchema": SchemaNode;
};
export type GameDescriptor = {
  "gameId": string;
  "titleKey": string;
  "mode": string; // "realtime" | "turn" | "party"
  "minPlayers": number;
  "maxPlayers": number;
  "actions": Array<ActionSpec>;
};
export type Statistics = {
  "players": Array<{
    "playerId": string;
    "wins": number;
    "draws": number;
    "damage": number;
    "actions": Array<{
      "actionId": string;
      "opportunities": number;
      "uses": number;
    }>;
  }>;
  "durationTicks": number;
};
export type StepResult = {
  "state": State;
  "events": Array<{
    "eventId": string;
    "audience": Array<string>;
    "kind": string;
    "payload": Record<string, any>; // per game
  }>;
  "outcome": Outcome;
  "statisticsDelta": Statistics;
};
export type Snapshot = {
  "config": MatchConfig;
  "tick": number;
  "state": State;
  "stateHash": string;
};
export type Effect = {
  "operator": "damage" | "shield" | "knockback" | "cooldown";
  "amount": number;
  "durationTicks": number;
};
export type Move = {
  "id": string;
  "nameKey": string;
  "archetype": "melee" | "projectile" | "guard";
  "weightTier": number;
  "power": number;
  "effects": Array<Effect>;
  "authorKey": string;
  "licenseKey": string;
};
export type Character = {
  "id": string;
  "nameKey": string;
  "health": number;
  "speed": number;
  "moveIds": Array<string>;
  "authorKey": string;
  "licenseKey": string;
};
export type GameData = {
  "v": 1;
  "gameId": string;
  "characters": Array<Character>;
  "moves": Array<Move>;
  "weightTiers": Array<{
    "startupTicks": number;
    "recoveryTicks": number;
    "cooldownTicks": number;
    "stunTicks": number;
    "knockback": number;
    "hitStopTicks": number;
  }>;
  "tuning": {
    "damageScalePermille": number;
  };
  "gameRules": Record<string, any>; // per game (see packages/games/*/schemas.ts)
  "provenance": Array<{
    "authorKey": string;
    "licenseKey": string;
    "source": string;
    "noticeKey": string;
  }>;
};
export type MatchResult = {
  botSeats?: Array<string>;
  botPolicyVersion?: string;
  "matchId": string;
  "config": MatchConfig;
  "outcome": Outcome;
  "statistics": Statistics;
  "finalStateHash": string;
  "valid": boolean;
  "errorCode": string;
};
export type Report = {
  elapsedMs?: number;
  recorded?: boolean;
  createdAt?: string;
  humanMatches?: number;
  "reportId": string;
  "gameId": string;
  "simVersion": string;
  "dataHash": string;
  "botPolicyVersion": string;
  "seedSetId": string;
  "validMatches": number;
  "invalidMatches": number;
  "draws": number;
  "rows": Array<{
    "dimension": string;
    "wins": number;
    "games": number;
    "winRate": number;
    "ci95": Array<number>;
    "uses": number;
    "opportunities": number;
    "outlier": boolean;
  }>;
};
export type PatchProposal = {
  "baseDataHash": string;
  "replacements": Array<{
    "path": string;
    "value": number;
  }>;
  "rationale": string;
};
export declare const schema: Record<string, unknown>;
export declare function canonicalJson(value: unknown): string;
export declare function hash(value: unknown): string;
export declare function validate<K extends keyof ContractTypes>(name: K, value: unknown): ContractTypes[K];
export declare function validateSchema(schema: Record<string, unknown>, value: unknown): unknown;
export interface ContractTypes {
  ActionInput: ActionInput;
  InputFrame: InputFrame;
  MatchConfig: MatchConfig;
  State: State;
  Observation: Observation;
  Outcome: Outcome;
  ActionSpec: ActionSpec;
  GameDescriptor: GameDescriptor;
  Statistics: Statistics;
  StepResult: StepResult;
  Snapshot: Snapshot;
  Effect: Effect;
  Move: Move;
  Character: Character;
  GameData: GameData;
  MatchResult: MatchResult;
  Report: Report;
  PatchProposal: PatchProposal;
}
export declare function registerGame(gameId: string, schemaVersion: number, schemas: Record<string, Record<string,
  unknown>>): void;
export declare function validateGamePayload(gameId: string, schemaVersion: number, kind: string,
  payload: unknown): unknown;
export declare function validateData(data: GameData): GameData;
export declare function validateConfig(config: MatchConfig, data: GameData, descriptor: GameDescriptor,
  simVersion: string): MatchConfig;
export declare function validateOutcome(outcome: Outcome, players: string[]): void;
export declare function validateFrame(state: State, frame: InputFrame, players: string[], specs: ActionSpec[],
  legal: (action: ActionInput) => boolean, allowMoveAndAttack?: boolean): void;
export declare function restoreSnapshot(snapshot: Snapshot, config: MatchConfig): State;
/** `root` is the original game data that hero-stat bounds (within 40%) are measured against; default: `data`. */
export declare function applyPatch(data: GameData, proposal: PatchProposal, root?: GameData): GameData;
export declare function compareIds(a: string, b: string): number;
export interface GameAdapter {
  describe(): GameDescriptor;
  initial(config: MatchConfig, data: GameData): State;
  observe(state: State, playerId: string): Observation;
  legalActions(observation: Observation): ActionSpec[];
  step(state: State, frame: InputFrame, data: GameData): StepResult;
  outcome(state: State): Outcome;
  statistics(state: State): Statistics;
  hash(state: State): string;
}

// Validation helpers shared by the games and the services.
export type ErrorCode = 'INVALID_SCHEMA' | 'VERSION_MISMATCH' | 'HASH_MISMATCH' | 'LATE_INPUT' | 'STALE_TURN' |
  'ILLEGAL_ACTION' | 'PATCH_REJECTED';
export type GameSchemas = { state: SchemaNode; observation: SchemaNode; rules: SchemaNode;
  [name: string]: SchemaNode };

/** What `Authority.submit` answers for an input. */
export type Receipt = { seq: number; status: 'accepted'; acceptedTick: number };
/** A recorded match: enough to replay it exactly. */
export type Recording = { matchId: string; seed: number; config: MatchConfig; frames: InputFrame[];
  finalStateHash: string; botSeats?: string[] };

// ---- Game 3: Sepia Tentacle Run (gameId "tentacle_run"), solo, 60 Hz, integer math -----------------------------
// Coordinates are integers in the 16000 x 9000 arena (origin top-left, y grows downwards). One tick = 1/60 s.
// The seat is always "p1" (Sepia). Actions: move {moveX, moveY} (-1000..1000), latch {aimX, aimY} (-1000..1000, the
// direction to the post to latch onto), whip {aimX, aimY}. See packages/games/tentacle/SPEC.md.
export type TentacleWave = {
  walkers: number; drones: number; sentries: number; // how many of each spawn
  enemySpeed: number; // units per tick of walkers (drones fly at 3/4 of it)
  enemyDamage: number; // hit points taken per walker touch, drone shot or sentry shot
  fireIntervalTicks: number; // ticks between shots of one drone or sentry
  flaw?: string; // set on the wave that is designed to be nearly unbeatable (a note, not a rule)
};
export type TentacleRules = {
  arena: { w: number; h: number };
  posts: Array<{ id: number; x: number; y: number }>; // the fixed grid of anchor posts (15: 5 columns x 3 rows)
  player: { health: number; speed: number; latchRange: number; latchSpeed: number; latchCooldownTicks: number;
    latchInvulnerableTicks: number; whipRange: number; whipDamage: number; whipCooldownTicks: number };
  enemies: { walker: { health: number }; drone: { health: number }; sentry: { health: number } };
  waves: TentacleWave[]; // 5 waves; the Man-Shark boss follows
  boss: { health: number; speed: number; contactDamage: number; shotDamage: number; fireIntervalTicks: number;
    phases: number }; // phase = which third of the health bar the boss is in (0..phases-1), for the HP bar pips
  betweenWavesTicks: number;
  healOnClear: number;
};
export type TentacleEntityKind = 'player' | 'walker' | 'drone' | 'sentry' | 'boss';
export type TentacleEntity = {
  id: string; // "p1", "e<N>", "boss"
  kind: TentacleEntityKind;
  x: number; y: number; hp: number; maxHp: number;
  facingX: number; facingY: number; // last aim direction, -1000..1000 (the scene turns the sprite)
  // player only (null on the others):
  latch: null | { post: number; untilTick: number }; // while latched the tentacle goes from the player to posts[post]
  latchReadyTick: number; whipReadyTick: number; invulnerableUntilTick: number; whipUntilTick: number;
};
export type TentacleProjectile = { id: string; x: number; y: number; vx: number; vy: number; life: number;
  damage: number; from: 'drone' | 'sentry' | 'boss' };
/** The payload of state.view (Observation.payload) and of the state itself, the same shape for the one seat. */
export type TentacleObservationPayload = {
  wave: number; // 1..5 = the waves, 6 = the boss, 0 = the break before wave 1; wave 7 never happens (the run ends)
  waveCount: number; // 5 (the boss is wave 6)
  waveTick: number; // ticks since this wave started (0 during the break between waves)
  entities: TentacleEntity[]; // the player first, then the enemies in spawn order; the boss has kind "boss"
  posts: Array<{ id: number; x: number; y: number }>;
  projectiles: TentacleProjectile[];
  boss: null | { hp: number; maxHp: number; phase: number; phases: number }; // null until the boss wave
  outcome: Outcome;
};
