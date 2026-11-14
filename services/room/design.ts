// Design intent files: the designer's intended win rate per matchup (rules: packages/analysis/src/intent.js).
// services/room/design/<gameId>-intent.json is a committed design file, not runtime output. Changing the intent
// never changes a data hash; every report records the intent version it used.
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
  constructor(message) {
    super(message);
    this.code = 'INVALID_SCHEMA';
  }
}

const heroIdsOf = gameId => (gameId === 'hero_arena' ? games.hero_arena.data.characters :
  games.hero_cards.data.gameRules.decks).map(item => item.id);

export class DesignStore {
  constructor(directory = DESIGN_DIR) {
    this.directory = directory;
  }
  path(gameId) {
    if (!Object.hasOwn(games, gameId)) throw Error('INVALID_SCHEMA');
    return join(this.directory, `${gameId}-intent.json`);
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
  /** The saved intent, or the all-even default when there is no file. */
  async get(gameId) {
    const path = this.path(gameId);
    if (!existsSync(path)) return structuredClone(EMPTY_INTENT);
    return this.validate(gameId, JSON.parse(readFileSync(path, 'utf8')));
  }
  /** Validates a body (not saved). A body without a version gets one from its content: same intent, same version. */
  async prepare(gameId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DesignError('the body must be an object');
    const version = body.version ?? `intent-${hash(body.matchups ?? {}).slice(0, 8)}`;
    return this.validate(gameId, { ...body, version });
  }
  async put(gameId, body) {
    const intent = await this.prepare(gameId, body);
    writeJson(this.path(gameId), intent);
    return intent;
  }
}
