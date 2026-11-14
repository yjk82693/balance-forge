import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSchema } from '../../packages/contracts/index.js';
import { object, text, integer, array } from '../../packages/contracts/shapes.js';
import { writeJson } from './files.js';
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const number = { type: 'number' };
const rate = { type: 'number', minimum: 0, maximum: 1 };
const result = object({ rate, ci95: { type: 'array', items: rate, minItems: 2, maxItems: 2 }, games: integer() });
const change = object({ path: text(256), label: text(256), old: number, new: number }, ['path', 'old', 'new']);
const recordSchema = object({
  dataHash: digest, parentHash: nullable(digest), gameId: { enum: ['hero_arena', 'hero_cards'] },
  createdAt: text(64), origin: { enum: ['base', 'gemini', 'grok', 'fallback', 'fake', 'manual'] },
  changes: array(change, 64), rationale: { type: 'string', maxLength: 8192 },
  target: nullable(object({ matchup: text(256), before: result, after: result })),
  verdict: nullable(object({ verdict: { enum: ['accepted', 'rejected', 'inconclusive'] },
    reasons: array({ type: 'string', maxLength: 8192 }, 100) })),
  approved: { type: 'boolean' }, note: { type: 'string', maxLength: 8192 }
}, ['dataHash', 'parentHash', 'gameId', 'createdAt', 'origin', 'changes', 'rationale', 'target',
  'verdict', 'approved']);
export function validateVersion(record) {
  validateSchema(recordSchema, record);
  if (!Number.isFinite(Date.parse(record.createdAt))) throw Error('INVALID_SCHEMA');
  if ((record.origin === 'base') !== (record.parentHash === null)) throw Error('INVALID_SCHEMA');
  if (record.target) for (const result of [record.target.before, record.target.after]) {
    if (result.ci95[0] > result.ci95[1]) throw Error('INVALID_SCHEMA');
  }
  return record;
}
export function patchChanges(base, patched, proposal) {
  const at = (data, path) => path.split('/').slice(1).reduce((value, key) => {
    key = key.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!value || !Object.hasOwn(value, key)) throw Error('INVALID_SCHEMA');
    return value[key];
  }, data);
  return proposal.replacements.map(({ path }) => ({ path, old: at(base, path), new: at(patched, path) }));
}
export function numericDiff(base, data, path = '') {
  if (typeof base === 'number' && typeof data === 'number') {
    return base === data ? [] : [{ path, old: base, new: data }];
  }
  if (!base || !data || typeof base !== 'object' || typeof data !== 'object') return [];
  return Object.keys(base).filter(key => Object.hasOwn(data, key)).sort().flatMap(key =>
    numericDiff(base[key], data[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
}
export class VersionStore {
  constructor(directory) {
    this.directory = join(directory, 'data', 'versions');
  }
  path(gameId) {
    if (!['hero_arena', 'hero_cards'].includes(gameId)) throw Error('INVALID_SCHEMA');
    return join(this.directory, `${gameId}.json`);
  }
  list(gameId) {
    const path = this.path(gameId);
    const records = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    if (!Array.isArray(records)) throw Error('INVALID_SCHEMA');
    for (const record of records) {
      validateVersion(record);
      if (record.gameId !== gameId) throw Error('INVALID_SCHEMA');
    }
    return records;
  }
  get(gameId, dataHash) {
    validateSchema(digest, dataHash);
    return this.list(gameId).find(record => record.dataHash === dataHash) ?? null;
  }
  add(record) {
    validateVersion(record);
    const records = this.list(record.gameId);
    const previous = records.find(item => item.dataHash === record.dataHash);
    if (previous) return previous;
    if (record.parentHash !== null && !records.some(item => item.dataHash === record.parentHash)) {
      throw Error('HASH_MISMATCH');
    }
    writeJson(this.path(record.gameId), [...records, record]);
    return structuredClone(record);
  }
  approve(gameId, dataHash) {
    const record = this.get(gameId, dataHash);
    if (!record) return null;
    const approved = { ...record, approved: true };
    writeJson(this.path(gameId), this.list(gameId).map(item => item.dataHash === dataHash ? approved : item));
    return approved;
  }
}
