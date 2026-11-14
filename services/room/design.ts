// Design intent files: the designer's intended win rate per matchup (rules: packages/analysis/src/intent.js).
// services/room/design/<gameId>-intent.json is the committed default and is read-only for the server: a PUT writes
// the runtime intent under the storage directory (services/room/data/design/, git-ignored), and GET answers with the
// runtime intent when there is one, else the default. Changing the intent never changes a data hash; every report
// records the intent version it used.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../../packages/contracts/index.ts';
import { games } from '../runner/match.ts';
import { writeJson } from './files.ts';

export const DESIGN_DIR = fileURLToPath(new URL('./design', import.meta.url));
export const EMPTY_INTENT = Object.freeze({ version: 'default', matchups: {} }); // everything even

const analysis = () => import('../../packages/analysis/src/intent.ts');

export class DesignError extends Error {
  declare code: string;
  constructor(message: string) {
    super(message);
    this.code = 'INVALID_SCHEMA';
  }
}

const heroIdsOf = gameId => (gameId === 'hero_arena' ? games.hero_arena.data.characters :
  games.hero_cards.data.gameRules.decks).map(item => item.id);

export class DesignStore {
  declare directory: string;
  declare runtimeDirectory: string | undefined;
  /** defaultDir: the committed defaults (never written). runtimeDir: where a PUT saves; without it a PUT fails. */
  constructor(defaultDir = DESIGN_DIR, runtimeDir = undefined) {
    this.directory = defaultDir;
    this.runtimeDirectory = runtimeDir;
  }
  path(gameId) {
    if (!Object.hasOwn(games, gameId)) throw Error('INVALID_SCHEMA');
    return join(this.directory, `${gameId}-intent.json`);
  }
  runtimePath(gameId) {
    if (!Object.hasOwn(games, gameId) || !this.runtimeDirectory) throw Error('INVALID_SCHEMA');
    return join(this.runtimeDirectory, `${gameId}-intent.json`);
  }
  /** Checks an intent (shape, known heroes, no mirrors, each pair once) and returns it with canonical keys. */
  async validate(gameId, raw) {
    const { normalizeIntent } = await analysis();
    let intent;
    try {
      intent = normalizeIntent(raw);
    } catch (error) {
      throw new DesignError(String(error.message).slice(0, 200));
    }
    const heroes = new Set(heroIdsOf(gameId));
    for (const key of [...Object.keys(intent.matchups), ...Object.keys(intent.notes ?? {})]) {
      for (const hero of key.split(' vs ')) {
        if (!heroes.has(hero)) throw new DesignError(`unknown hero ${hero} in ${key}`);
      }
    }
    return intent;
  }
  /** The default intent (committed file), or all-even when there is none. Stable: never the runtime intent. */
  async getDefault(gameId) {
    const path = this.path(gameId);
    if (!existsSync(path)) return structuredClone(EMPTY_INTENT);
    return this.validate(gameId, JSON.parse(readFileSync(path, 'utf8')));
  }
  /** The runtime intent when one was saved, else the default. */
  async get(gameId) {
    const path = this.runtimeDirectory ? this.runtimePath(gameId) : null;
    if (path && existsSync(path)) return this.validate(gameId, JSON.parse(readFileSync(path, 'utf8')));
    return this.getDefault(gameId);
  }
  /** Validates a body (not saved). A body without a version gets one from its content: same intent, same version. */
  async prepare(gameId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DesignError('the body must be an object');
    const version = body.version ?? `intent-${hash(body.matchups ?? {}).slice(0, 8)}`;
    // A body without notes keeps the notes of the intent it replaces (the chips edit strengths, not the explanations).
    const notes = body.notes ?? (await this.get(gameId)).notes;
    return this.validate(gameId, { ...body, version, ...(notes === undefined ? {} : { notes }) });
  }
  async put(gameId, body) {
    const intent = await this.prepare(gameId, body);
    writeJson(this.runtimePath(gameId), intent);
    return intent;
  }
}
