import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from './files.ts';
export { writeJson } from './files.ts';
import { VersionStore, patchChanges, validateVersion, numericDiff } from './versions.ts';
import { hash, validate, validateData, applyPatch } from '../../packages/contracts/index.ts';
import { pinData } from '../../packages/sim/index.ts';
import { games } from '../runner/match.ts';
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
    this.versionStore = new VersionStore(directory);
    for (const game of Object.values(games)) this.versionStore.add({
      dataHash: hash(game.data), parentHash: null, gameId: game.data.gameId,
      createdAt: new Date().toISOString(), origin: 'base', changes: [], rationale: 'Original game data.',
      target: null, verdict: null, approved: true
    });
    this.restoreVersionRecords();
  }
  restoreVersionRecords() {
    for (const [gameId, game] of Object.entries(games)) {
      const folder = join(this.directory, 'data', gameId);
      for (const name of readdirSync(folder).sort()) {
        if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
        const dataHash = name.slice(0, -5);
        if (this.versionStore.get(gameId, dataHash)) continue;
        const { data } = this.get(gameId, dataHash);
        this.recordVersion({
          gameId, dataHash, parentHash: hash(game.data), createdAt: new Date().toISOString(), origin: 'manual',
          changes: numericDiff(game.data, data), rationale: 'Imported retained data into version history.',
          target: null, verdict: null, approved: false,
          note: 'Original lineage is unavailable; imported as a branch compared with base data.'
        });
      }
    }
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
  saveIndex(current = this.current) {
    writeJson(join(this.directory, 'data', 'current.json'), Object.fromEntries(current));
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
      candidate = applyPatch(base.data, proposal, games[gameId].data); // hero stats stay within 40% of the root
    } catch {
      throw Error('PATCH_REJECTED');
    }
    const digest = this.addVersion(candidate);
    this.recordVersion({
      dataHash: digest, parentHash: base.dataHash, gameId, createdAt: new Date().toISOString(),
      origin: 'manual', changes: patchChanges(base.data, candidate, proposal), rationale: proposal.rationale,
      target: null, verdict: null, approved: false
    });
    this.select(gameId, digest);
    return {
      dataHash: digest,
      baseDataHash: base.dataHash
    };
  }
  recordVersion(record) {
    validateVersion(record);
    const { data } = this.get(record.gameId, record.dataHash);
    if (record.parentHash === null) {
      if (record.dataHash !== hash(games[record.gameId].data)) throw Error('HASH_MISMATCH');
    } else {
      const parent = this.get(record.gameId, record.parentHash);
      const changes = patchChanges(parent.data, data, { replacements: record.changes });
      if (changes.some((change, index) => change.old !== record.changes[index].old ||
          change.new !== record.changes[index].new)) throw Error('HASH_MISMATCH');
    }
    const known = Boolean(this.versionStore.get(record.gameId, record.dataHash));
    const added = this.versionStore.add(record);
    if (!known) this.sinks?.emit('version', added ?? record);
    return added;
  }
  select(gameId, dataHash) {
    this.get(gameId, dataHash);
    if (!this.versionStore.get(gameId, dataHash)) throw Error('HASH_MISMATCH');
    const nextCurrent = new Map(this.current);
    nextCurrent.set(gameId, dataHash);
    this.saveIndex(nextCurrent);
    this.current = nextCurrent;
    return { gameId, dataHash };
  }
  recordReplay(recording) {
    if (!recording || !Array.isArray(recording.frames)) throw Error('INVALID_SCHEMA');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(recording.matchId)) throw Error('INVALID_SCHEMA');
    validate('MatchConfig', recording.config);
    if (recording.seed !== recording.config.seed) throw Error('INVALID_SCHEMA');
    if (!/^[0-9a-f]{64}$/.test(recording.finalStateHash ?? '')) throw Error('INVALID_SCHEMA');
    for (const frame of recording.frames) validate('InputFrame', frame);
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
    if (result.botSeats?.some(id => !result.config.players.includes(id))) throw Error('INVALID_SCHEMA');
    if (this.humans.some(r => r.matchId === result.matchId)) return;
    if (recording) {
      if (recording.matchId !== result.matchId || recording.finalStateHash !== result.finalStateHash || hash(
        recording.config) !== hash(result.config)) throw Error('HASH_MISMATCH');
      this.recordReplay(recording);
    }
    const records = [...this.humans, result];
    writeJson(this.humanPath, records);
    this.humans = records;
    this.sinks?.emit('human', result);
  }
}
