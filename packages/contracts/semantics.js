import { hash, validate, validateSchema } from './index.js';
const fail = (code = 'INVALID_SCHEMA') => { throw Error(code); };
export const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = values => { if (new Set(values).size !== values.length) fail(); };
const registries = new Map();
export function registerGame(gameId, schemaVersion, schemas) {
  for (const name of ['state', 'observation', 'rules']) if (!schemas[name]) fail();
  registries.set(`${gameId}/${schemaVersion}`, structuredClone(schemas));
}
export function validateGamePayload(gameId, schemaVersion, kind, payload) {
  const entry = registries.get(`${gameId}/${schemaVersion}`);
  if (!entry?.[kind]) fail();
  return validateSchema(entry[kind], payload);
}
export function validateData(data) {
  validate('GameData', data);
  unique(data.characters.map(x => x.id)); unique(data.moves.map(x => x.id));
  const moves = new Set(data.moves.map(x => x.id));
  const provenance = new Set(data.provenance.map(x => `${x.authorKey}/${x.licenseKey}`));
  for (const item of [...data.characters, ...data.moves]) {
    if (!provenance.has(`${item.authorKey}/${item.licenseKey}`)) fail();
    if (item.moveIds?.some(id => !moves.has(id))) fail();
  }
  validateGamePayload(data.gameId, 1, 'rules', data.gameRules);
  return data;
}
export function validateConfig(config, data, descriptor, simVersion) {
  validate('MatchConfig', config); validateData(data);
  if (config.gameId !== data.gameId || config.gameId !== descriptor.gameId || config.simVersion !== simVersion || config.mode !== descriptor.mode) fail('VERSION_MISMATCH');
  if (hash(data) !== config.dataHash) fail('HASH_MISMATCH');
  if (config.players.length < descriptor.minPlayers || config.players.length > descriptor.maxPlayers) fail();
  return config;
}
export function validateOutcome(outcome, players) {
  validate('Outcome', outcome);
  if (outcome.winners.some(id => !players.includes(id)) || (outcome.status === 'win') !== (outcome.winners.length > 0)) fail();
}
export function validateFrame(state, frame, players, specs, legal) {
  validate('InputFrame', frame);
  if (frame.tick !== state.tick + 1) fail('LATE_INPUT');
  unique(frame.actions.map(x => x.playerId));
  const sorted = [...frame.actions].sort((a,b) => compareIds(a.playerId,b.playerId) || a.seq-b.seq);
  if (frame.actions.some((x,i) => x !== sorted[i])) fail();
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
export function restoreSnapshot(snapshot, config) {
  validate('Snapshot', snapshot);
  for (const key of ['contractVersion','schemaVersion','gameId','simVersion','dataHash']) if (snapshot.config[key] !== config[key]) fail('VERSION_MISMATCH');
  if (hash(snapshot.config) !== hash(config)) fail('VERSION_MISMATCH');
  if (snapshot.tick !== snapshot.state.tick || snapshot.stateHash !== hash(snapshot.state)) fail('HASH_MISMATCH');
  validateGamePayload(config.gameId, config.schemaVersion, 'state', snapshot.state.payload);
  return structuredClone(snapshot.state);
}
export function applyPatch(data, proposal) {
  validate('PatchProposal', proposal);
  if (proposal.baseDataHash !== hash(data)) fail('PATCH_REJECTED');
  const result = structuredClone(data), paths = new Set();
  for (const {path,value} of proposal.replacements) {
    if (paths.has(path)) fail('PATCH_REJECTED'); paths.add(path);
    if (path === '/tuning/damageScalePermille') {
      if (value < 100 || value > 3000) fail('PATCH_REJECTED');
      result.tuning.damageScalePermille = value;
    } else {
      const index = Number(path.split('/')[2]);
      if (!result.moves[index]) fail('PATCH_REJECTED');
      result.moves[index].power = value;
    }
  }
  validateData(result); return result;
}
