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

// ---- Game 3: Sepia Tentacle Run (gameId "tentacle_run"), a 2D side-scrolling wire runner ----------------------
// Solo, 60 Hz, integer math, seeded. Side view: x grows to the right (the course runs from x = 0 to finishX), y
// grows UP with the ground at y = 0 (a pit is a gap in the ground). Sepia auto-runs right at the section's
// runSpeed. The only
// input is the action "control" { jump: 0 | 1, slide: 0 | 1 } (held flags; the game keeps the last one until a new
// one arrives). First jump press = jump; a second press in the air = fire the hook at the nearest anchor and swing
// (a pendulum); release = let go with the momentum. Slide held on the ground = slide. See
// packages/games/tentacle/SPEC.md.
export type TentacleSection = {
  length: number; pits: number; lowBars: number; walls: number; // how long, and how many of each obstacle
  anchorSpacing: number; // distance between overhead anchor posts (the wire reaches `wireRange`)
  runSpeed: number; // units per tick
  flaw?: string; // set on the section designed to be nearly unbeatable (a note, not a rule)
};
export type TentacleRules = {
  viewWidth: number; // the camera shows [cameraX, cameraX + viewWidth]
  leadIn: number; // x where the first section starts
  player: { width: number; height: number; slideHeight: number };
  physics: { gravity: number; jumpVelocity: number; maxFall: number; tapTicks: number; wireRange: number;
    wireMinLength: number; swingGravity: number; reelSpeed: number; // the rope shortens by this per tick while attached
    releaseBoost: number }; // extra upward speed when the wire is let go
  obstacles: { pitWidth: number; lowBarWidth: number; lowBarBottom: number; lowBarTop: number; wallWidth: number;
    wallHeight: number; anchorHeight: number };
  sections: TentacleSection[]; // 6 sections; the last is the Man-Shark chase
};
export type TentaclePlayerState = 'running' | 'jumping' | 'sliding' | 'swinging';
// a pit has y = 0, h = 0 (a gap in the ground); a lowBar spans y..y+h in the air; a wall stands on the ground
export type TentacleObstacle = { id: string; kind: 'pit' | 'lowBar' | 'wall'; x: number; w: number; y: number;
  h: number; section: number };
export type TentacleAnchor = { id: string; x: number; y: number; section: number;
  overPit: boolean }; // true = a pillar top over a swing chasm (draw it rising from the chasm); false = before a wall
/** The payload of state.view (Observation.payload); the state itself carries the same fields plus the full course. */
export type TentacleObservationPayload = {
  section: number; // 1..6: the section Sepia is in (6 = the Man-Shark chase)
  sectionCount: number; // 6
  sectionStartX: number; sectionEndX: number; // of the current section
  cameraX: number; viewWidth: number; // the camera: [cameraX, cameraX + viewWidth]; cameraX = max(0, player.x - 4000)
  finishX: number;
  player: { x: number; y: number; vx: number; vy: number; state: TentaclePlayerState; height: number;
    jumpHeldTicks: number; airTicks: number; // ticks since the ground (coyote time lets a jump still work for 6)
    jumpBuffer: number; jumped: boolean; // a jump pressed up to 7 ticks before landing fires on landing
    wire: null | { anchorId: string; anchorX: number; anchorY: number; length: number } };
  obstacles: TentacleObstacle[]; // only those inside [cameraX - 1000, cameraX + viewWidth + 1000]
  anchors: TentacleAnchor[]; // likewise
  shark: null | { x: number }; // the Man-Shark chasing in the last section (drawn behind Sepia), else null
  outcome: Outcome;
  versus?: TentacleVersus; // only in a 1v1 match
};
// 1v1 (versus): two seats p1 and p2 (both Sepia) run the same course from the same seed and never interact. Each
// seat's view is its OWN runner (its camera, player, obstacles, anchors) plus `versus`. The viewer 'display' gets the
// leader's view (the one further right, p1 on a tie). The first death ends the match: the survivor wins
// ('opponent_down');
// both dead on the same tick: the one further right wins, an exact tie is a draw ('draw', winners []). A match is
// versus when config.players has two seats; match.start { gameId: 'tentacle_run', versus: true } with 2 phones.
export type TentacleVersus = {
  you: string | null; // 'p1' | 'p2' for a seat, null for the display
  opponent: null | { id: string; x: number; state: TentaclePlayerState; alive: boolean }; // null for the display
  // both, p1 first; everything needed to draw each runner (the laptop shows both on one screen)
  runners: Array<{ id: string; x: number; y: number; vx: number; vy: number; state: TentaclePlayerState;
    height: number; wire: null | { anchorId: string; anchorX: number; anchorY: number; length: number };
    alive: boolean; section: number }>;
  leader: string; // the id of the runner further right (p1 on a tie)
};
