// Loads the trained parameters from services/runner/learned/<hero>.json. A file from another policy, or whose
// parameters are out of range, is skipped and reported (never trusted half-way); the rest of the roster still loads.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLearnedBot, POLICY_ID, validateParams } from '../../../packages/games/action/bot-learned.js';

export const LEARNED_DIR = fileURLToPath(new URL('../learned', import.meta.url));
// BALANCE_FORGE_LEARNED_DIR points the runner at another directory (tests, a second training run).
export const learnedDir = () => process.env.BALANCE_FORGE_LEARNED_DIR ?? LEARNED_DIR;

/** Reads every <hero>.json. Returns { paramsByHero, files, skipped: [{ file, reason }] }. */
export function readLearned(dir = LEARNED_DIR) {
  const paramsByHero = {};
  const files = {};
  const skipped = [];
  if (!existsSync(dir)) return { paramsByHero, files, skipped };
  for (const name of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    try {
      const file = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (file?.policy !== POLICY_ID) throw Error('another policy');
      if (typeof file.hero !== 'string' || `${file.hero}.json` !== name) {
        throw Error('hero does not match the file name');
      }
      validateParams(file.params);
      paramsByHero[file.hero] = file.params;
      files[file.hero] = file;
    } catch (error) {
      skipped.push({ file: name, reason: String(error.message).slice(0, 120) });
    }
  }
  return { paramsByHero, files, skipped };
}

const cache = new Map();
/** The learned bot for a directory (default: learnedDir()), loaded once per process; null if nothing is usable. */
export function learnedBot(dir = learnedDir()) {
  if (!cache.has(dir)) {
    const { paramsByHero } = readLearned(dir);
    cache.set(dir, Object.keys(paramsByHero).length ? makeLearnedBot(paramsByHero) : null);
  }
  return cache.get(dir);
}
export const resetLearnedCache = () => cache.clear();
