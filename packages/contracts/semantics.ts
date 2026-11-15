import { hash } from './canonical.ts';
import { validate, validateSchema } from './validation.ts';
import type { ActionSpec, ErrorCode, GameData, GameDescriptor, GameSchemas, InputFrame, MatchConfig, Outcome,
  PatchProposal, Snapshot, State } from './types.ts';
const fail = (code: ErrorCode = 'INVALID_SCHEMA'): never => {
  throw Error(code);
};
export const compareIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const unique = (values: unknown[]): void => {
  if (new Set(values).size !== values.length) fail();
};
const registries = new Map<string, GameSchemas>();
export function registerGame(gameId: string, schemaVersion: number, schemas: GameSchemas): void {
  for (const name of ['state', 'observation', 'rules']) if (!schemas[name]) fail();
  registries.set(`${gameId}/${schemaVersion}`, structuredClone(schemas));
}
export function validateGamePayload(gameId: string, schemaVersion: number, kind: string, payload: unknown) {
  const entry = registries.get(`${gameId}/${schemaVersion}`);
  if (!entry || !Object.hasOwn(entry, kind)) fail();
  return validateSchema(entry[kind], payload);
}
export function validateData(data: GameData): GameData {
  validate('GameData', data);
  unique(data.characters.map(x => x.id));
  unique(data.moves.map(x => x.id));
  const moves = new Set(data.moves.map(x => x.id));
  const provenance = new Set(data.provenance.map(x => `${x.authorKey}/${x.licenseKey}`));
  for (const item of [...data.characters, ...data.moves]) {
    if (!provenance.has(`${item.authorKey}/${item.licenseKey}`)) fail();
    if ((item as { moveIds?: string[] }).moveIds?.some(id => !moves.has(id))) fail();
  }
  validateGamePayload(data.gameId, 1, 'rules', data.gameRules);
  return data;
}
export function validateConfig(config: MatchConfig, data: GameData, descriptor: Pick<GameDescriptor, 'gameId' | 'mode' |
  'minPlayers' | 'maxPlayers'>, simVersion: string): MatchConfig {
  validate('MatchConfig', config);
  validateData(data);
  if (config.gameId !== data.gameId || config.gameId !== descriptor.gameId || config.simVersion !== simVersion ||
    config.mode !== descriptor.mode) fail('VERSION_MISMATCH');
  if (hash(data) !== config.dataHash) fail('HASH_MISMATCH');
  if (config.players.length < descriptor.minPlayers || config.players.length > descriptor.maxPlayers) fail();
  if (config.options) {
    const ids = Object.keys(config.options.assignments);
    if (ids.length !== config.players.length || ids.some(id => !config.players.includes(id))) fail();
  }
  return config;
}
export function validateOutcome(outcome: Outcome, players: string[]): void {
  validate('Outcome', outcome);
  if (outcome.winners.some(id => !players.includes(id))) fail();
  const hasWinners = outcome.winners.length > 0;
  if (outcome.status === 'win' && !hasWinners) fail();
  if (outcome.status !== 'win' && hasWinners) fail();
}
export function validateFrame(state: Pick<State, 'tick' | 'turnId'>, frame: InputFrame, players: string[],
  specs: ActionSpec[], legal: (action: InputFrame['actions'][number]) => boolean, allowMoveAndAttack = false): void {
  validate('InputFrame', frame);
  if (frame.tick !== state.tick + 1) fail('LATE_INPUT');
  unique(frame.actions.map(x => allowMoveAndAttack ? JSON.stringify([x.playerId, x.actionId === 'move' ?
    'move' : 'attack']) : x.playerId));
  unique(frame.actions.map(x => JSON.stringify([x.playerId, x.seq])));
  const sorted = [...frame.actions].sort((a, b) => compareIds(a.playerId, b.playerId) || a.seq - b.seq);
  if (frame.actions.some((x, i) => x !== sorted[i])) fail();
  for (const action of frame.actions) {
    if (!players.includes(action.playerId)) fail('ILLEGAL_ACTION');
    if (action.tick !== frame.tick) fail('LATE_INPUT');
    if (action.turnId !== state.turnId) fail('STALE_TURN');
    const spec = specs.find(x => x.actionId === action.actionId);
    if (!spec) fail('ILLEGAL_ACTION');
    validateSchema(spec.paramsSchema, action.params);
    if (!legal(action)) fail('ILLEGAL_ACTION');
  }
  for (const input of frame.systemInputs) {
    if (!players.includes(input.playerId) || input.turnId !== state.turnId) fail('STALE_TURN');
  }
}
export function restoreSnapshot(snapshot: Snapshot, config: MatchConfig): State {
  validate('Snapshot', snapshot);
  for (const key of ['contractVersion', 'schemaVersion', 'gameId', 'simVersion', 'dataHash']) if (snapshot.config[
    key] !== config[key]) fail('VERSION_MISMATCH');
  if (hash(snapshot.config) !== hash(config)) fail('VERSION_MISMATCH');
  if (snapshot.tick !== snapshot.state.tick || snapshot.stateHash !== hash(snapshot.state)) fail('HASH_MISMATCH');
  if (snapshot.state.payload.config && hash(snapshot.state.payload.config) !== hash(config)) fail('VERSION_MISMATCH');
  validateGamePayload(config.gameId, config.schemaVersion, 'state', snapshot.state.payload);
  return structuredClone(snapshot.state);
}
// Hero stats (contract v0.1.2): absolute bounds, and within 40% of the ROOT data value, so that repeated rounds cannot
// move a hero further than that. `root` is the original game data (default: the data being patched).
const HERO_STAT_BOUNDS = { health: [100, 3000], speed: [30, 400] };
const withinFortyPercent = (value: number, rootValue: number): boolean =>
  10 * value >= 6 * rootValue && 10 * value <= 14 * rootValue;
function heroStatPatch(result: GameData, root: GameData, path: string, value: number): void {
  const [, , index, stat] = path.split('/');
  const rootHero = root.characters[Number(index)];
  const [low, high] = HERO_STAT_BOUNDS[stat];
  if (!result.characters[Number(index)] || !rootHero || !Number.isInteger(rootHero[stat])) fail('PATCH_REJECTED');
  if (value < low || value > high || !withinFortyPercent(value, rootHero[stat])) fail('PATCH_REJECTED');
  result.characters[Number(index)][stat] = value;
}
// Hero Cards (contract v0.1.4): cost 1..3, power 1..10; a peek card has no power to change.
const CARD_BOUNDS = { cost: [1, 3], power: [1, 10] };
function cardPatch(result: GameData, path: string, value: number): void {
  const [, , , index, field] = path.split('/');
  const card = result.gameRules?.cards?.[Number(index)];
  const [low, high] = CARD_BOUNDS[field];
  if (!card || value < low || value > high || (field === 'power' && card.kind === 'peek')) fail('PATCH_REJECTED');
  card[field] = value;
}
// Tentacle Run (contract v0.1.5): wave numbers, integers, absolute bounds.
const WAVE_BOUNDS: Record<string, [number, number]> = { walkers: [0, 12], drones: [0, 10], sentries: [0, 8],
  enemySpeed: [5, 60], enemyDamage: [1, 60], fireIntervalTicks: [15, 300] };
function wavePatch(result: GameData, path: string, value: number): void {
  const [, , , index, field] = path.split('/');
  const wave = result.gameRules?.waves?.[Number(index)];
  const bounds = WAVE_BOUNDS[field];
  if (!wave || !bounds || value < bounds[0] || value > bounds[1]) fail('PATCH_REJECTED');
  wave[field] = value;
}
export function applyPatch(data: GameData, proposal: PatchProposal, root: GameData = data): GameData {
  validate('PatchProposal', proposal);
  if (proposal.baseDataHash !== hash(data)) fail('PATCH_REJECTED');
  const result = structuredClone(data),
    paths = new Set();
  for (const {
    path,
    value
  } of proposal.replacements) {
    if (paths.has(path)) fail('PATCH_REJECTED');
    paths.add(path);
    if (path === '/tuning/damageScalePermille') {
      if (value < 100 || value > 3000) fail('PATCH_REJECTED');
      result.tuning.damageScalePermille = value;
    } else if (path.startsWith('/gameRules/waves/')) {
      wavePatch(result, path, value);
    } else if (path.startsWith('/gameRules/cards/')) {
      cardPatch(result, path, value);
    } else if (path.startsWith('/characters/')) {
      heroStatPatch(result, root, path, value);
    } else {
      const index = Number(path.split('/')[2]);
      if (!result.moves[index]) fail('PATCH_REJECTED');
      result.moves[index].power = value;
    }
  }
  validateData(result);
  return result;
}
