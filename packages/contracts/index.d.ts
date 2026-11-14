// Wire types derived from the normative v0.1 schema.
export type ActionInput = { "playerId": string; "seq": number; "tick": number; "turnId": number; "actionId": string; "params": Record<string, unknown> };
export type InputFrame = { "tick": number; "actions": Array<ActionInput>; "systemInputs": Array<{ "kind": "system.timeout"; "playerId": string; "turnId": number }> };
export type MatchConfig = { "contractVersion": "0.1"; "schemaVersion": 1; "gameId": string; "simVersion": string; "dataHash": string; "seed": number; "players": Array<string>; "mode": "realtime" | "turn" | "party"; "maxTicks": number };
export type State = { "tick": number; "rng": number; "turnId": number; "payload": Record<string, unknown> };
export type Observation = { "tick": number; "viewerId": string; "payload": Record<string, unknown> };
export type Outcome = { "status": "running" | "win" | "draw"; "winners": Array<string>; "reason": string };
export type ActionSpec = { "actionId": string; "labelKey": string; "control": "button" | "axes" | "choice"; "paramsSchema": Record<string, unknown> };
export type GameDescriptor = { "gameId": string; "titleKey": string; "mode": "realtime" | "turn" | "party"; "minPlayers": number; "maxPlayers": number; "actions": Array<ActionSpec> };
export type Statistics = { "players": Array<{ "playerId": string; "wins": number; "draws": number; "damage": number; "actions": Array<{ "actionId": string; "opportunities": number; "uses": number }> }>; "durationTicks": number };
export type StepResult = { "state": State; "events": Array<{ "eventId": string; "audience": Array<string>; "kind": string; "payload": Record<string, unknown> }>; "outcome": Outcome; "statisticsDelta": Statistics };
export type Snapshot = { "config": MatchConfig; "tick": number; "state": State; "stateHash": string };
export type Effect = { "operator": "damage" | "shield" | "knockback" | "cooldown"; "amount": number; "durationTicks": number };
export type Move = { "id": string; "nameKey": string; "archetype": "melee" | "projectile" | "guard"; "weightTier": number; "power": number; "effects": Array<Effect>; "authorKey": string; "licenseKey": string };
export type Character = { "id": string; "nameKey": string; "health": number; "speed": number; "moveIds": Array<string>; "authorKey": string; "licenseKey": string };
export type GameData = { "v": 1; "gameId": string; "characters": Array<Character>; "moves": Array<Move>; "weightTiers": Array<{ "startupTicks": number; "recoveryTicks": number; "cooldownTicks": number; "stunTicks": number; "knockback": number; "hitStopTicks": number }>; "tuning": { "damageScalePermille": number }; "gameRules": Record<string, unknown>; "provenance": Array<{ "authorKey": string; "licenseKey": string; "source": string; "noticeKey": string }> };
export type MatchResult = { "matchId": string; "config": MatchConfig; "outcome": Outcome; "statistics": Statistics; "finalStateHash": string; "valid": boolean; "errorCode": string };
export type Report = { "reportId": string; "gameId": string; "simVersion": string; "dataHash": string; "botPolicyVersion": string; "seedSetId": string; "validMatches": number; "invalidMatches": number; "draws": number; "rows": Array<{ "dimension": string; "wins": number; "games": number; "winRate": number; "ci95": Array<number>; "uses": number; "opportunities": number; "outlier": boolean }> };
export type PatchProposal = { "baseDataHash": string; "replacements": Array<{ "path": string; "value": number }>; "rationale": string };
export declare const schema: Record<string, unknown>;
export declare function canonicalJson(value: unknown): string;
export declare function hash(value: unknown): string;
export declare function validate<K extends keyof ContractTypes>(name: K, value: unknown): ContractTypes[K];
export declare function validateSchema(schema: Record<string, unknown>, value: unknown): unknown;
export interface ContractTypes { ActionInput: ActionInput; InputFrame: InputFrame; MatchConfig: MatchConfig; State: State; Observation: Observation; Outcome: Outcome; ActionSpec: ActionSpec; GameDescriptor: GameDescriptor; Statistics: Statistics; StepResult: StepResult; Snapshot: Snapshot; Effect: Effect; Move: Move; Character: Character; GameData: GameData; MatchResult: MatchResult; Report: Report; PatchProposal: PatchProposal }
export declare function registerGame(gameId: string, schemaVersion: number, schemas: Record<string, Record<string, unknown>>): void;
export declare function validateGamePayload(gameId: string, schemaVersion: number, kind: string, payload: unknown): unknown;
export declare function validateData(data: GameData): GameData;
export declare function validateConfig(config: MatchConfig, data: GameData, descriptor: GameDescriptor, simVersion: string): MatchConfig;
export declare function validateOutcome(outcome: Outcome, players: string[]): void;
export declare function validateFrame(state: State, frame: InputFrame, players: string[], specs: ActionSpec[], legal: (action: ActionInput) => boolean): void;
export declare function restoreSnapshot(snapshot: Snapshot, config: MatchConfig): State;
export declare function applyPatch(data: GameData, proposal: PatchProposal): GameData;
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
