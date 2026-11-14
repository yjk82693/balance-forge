import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, validate, validateData, applyPatch } from '../../packages/contracts/index.js';
import { pinData } from '../../packages/sim/index.js';
import { games } from '../runner/match.js';
export function writeJson(path, value) {
  mkdirSync(dirname(path), {
    recursive: true
  });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}
export class Storage {
  constructor(directory) {
    this.directory = directory;
    this.versions = new Map();
    this.current = new Map();
    this.humanPath = join(directory, 'human-results.json');
    if (!existsSync(this.humanPath)) writeJson(this.humanPath, []);
    this.humans = JSON.parse(readFileSync(this.humanPath, 'utf8'));
    if (!Array.isArray(this.humans)) throw Error('INVALID_SCHEMA');
    for (const result of this.humans) validate('MatchResult', result);
    const indexPath = join(directory, 'data', 'current.json');
    const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
    for (const [gameId, game] of Object.entries(games)) {
      this.addVersion(game.data);
      if (index[gameId]) {
        const restored = JSON.parse(readFileSync(join(directory, 'data', gameId, `${index[gameId]}.json`), 'utf8'));
        if (hash(restored) !== index[gameId] || restored.gameId !== gameId) throw Error('HASH_MISMATCH');
        this.addVersion(restored);
        this.current.set(gameId, index[gameId]);
      } else this.current.set(gameId, hash(game.data));
    }
    this.saveIndex();
  }
  addVersion(data) {
    validateData(data);
    const digest = pinData(data);
    const path = join(this.directory, 'data', data.gameId, `${digest}.json`);
    if (!existsSync(path)) writeJson(path, data);else if (hash(JSON.parse(readFileSync(path,
      'utf8'))) !== digest) throw Error('HASH_MISMATCH');
    this.versions.set(digest, data);
    return digest;
  }
  saveIndex() {
    writeJson(join(this.directory, 'data', 'current.json'), Object.fromEntries(this.current));
  }
  get(gameId, digest = this.current.get(gameId)) {
    if (!Object.hasOwn(games, gameId)) throw Error('INVALID_SCHEMA');
    if (!/^[0-9a-f]{64}$/.test(digest ?? '')) throw Error('HASH_MISMATCH');
    let data = this.versions.get(digest);
    if (!data) {
      const path = join(this.directory, 'data', gameId, `${digest}.json`);
      if (!existsSync(path)) throw Error('HASH_MISMATCH');
      data = JSON.parse(readFileSync(path, 'utf8'));
      if (hash(data) !== digest) throw Error('HASH_MISMATCH');
      this.addVersion(data);
    }
    if (data.gameId !== gameId) throw Error('HASH_MISMATCH');
    return {
      data,
      dataHash: digest
    };
  }
  patch(gameId, proposal) {
    // A proposal may branch from a retained base, but never mutates it or an active match.
    const base = this.get(gameId, proposal?.baseDataHash);
    let candidate;
    try {
      candidate = applyPatch(base.data, proposal);
    } catch {
      throw Error('PATCH_REJECTED');
    }
    const digest = this.addVersion(candidate);
    this.current.set(gameId, digest);
    this.saveIndex();
    return {
      dataHash: digest,
      baseDataHash: base.dataHash
    };
  }
  recordReplay(recording) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(recording.matchId)) throw Error('INVALID_SCHEMA');
    validate('MatchConfig', recording.config);
    if (recording.seed !== recording.config.seed) throw Error('INVALID_SCHEMA');
    recording.frames.forEach(frame => validate('InputFrame', frame));
    const path = join(this.directory, 'replays', `${recording.matchId}.json`);
    if (existsSync(path)) {
      if (hash(JSON.parse(readFileSync(path, 'utf8'))) !== hash(recording)) throw Error('HASH_MISMATCH');
      return;
    }
    writeJson(path, recording);
  }
  getReplay(matchId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(matchId)) throw Error('INVALID_SCHEMA');
    const path = join(this.directory, 'replays', `${matchId}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  }
  record(result, recording) {
    validate('MatchResult', result);
    if (this.humans.some(r => r.matchId === result.matchId)) return;
    if (recording) this.recordReplay(recording);
    const records = [...this.humans, result];
    writeJson(this.humanPath, records);
    this.humans = records;
  }
}
