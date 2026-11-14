// Report storage boundary. JSON-file implementation works offline; TigerData is a placeholder only.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, safely } from './errors.js';
import { assertReport } from './input-check.js';

/**
 * @typedef {Object} ReportStorage
 * @property {(report: object) => Promise<{reportId: string}>} saveReport
 * @property {(filter?: {gameId?: string}) => Promise<object[]>} listReports  summaries, oldest first
 * @property {(reportId: string) => Promise<object|null>} getReport
 */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/; // no slashes or dots-only: ids become file names

export const summarize = (r) => ({
  reportId: r.reportId,
  gameId: r.gameId,
  dataHash: r.dataHash,
  validMatches: r.validMatches,
  invalidMatches: r.invalidMatches,
  createdAt: r.createdAt ?? null,
  recorded: r.recorded ?? null,
});

export class JsonFileStorage {
  #dir;
  constructor(dir) {
    this.#dir = dir;
  }
  #path(id) {
    if (typeof id !== 'string' || !ID_RE.test(id) || id.includes('..')) fail('INVALID_INPUT', 'invalid reportId (letters, digits, . _ - only)');
    return join(this.#dir, `${id}.json`);
  }
  async saveReport(report) {
    assertReport(report);
    const path = this.#path(report.reportId);
    try {
      mkdirSync(this.#dir, { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n');
      renameSync(tmp, path);
    } catch {
      fail('IO_ERROR', 'could not write the report file');
    } // same reportId overwrites: reports are immutable by convention, callers choose new ids
    return { reportId: report.reportId };
  }
  async getReport(reportId) {
    const path = this.#path(reportId);
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      return fail(e instanceof SyntaxError ? 'INVALID_JSON' : 'IO_ERROR', `could not read report ${reportId}`);
    }
  }
  async listReports(filter = {}) {
    let names;
    try {
      names = readdirSync(this.#dir).filter((n) => n.endsWith('.json'));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      return fail('IO_ERROR', 'could not list the report folder');
    }
    const out = names.map((n) => {
      try {
        return summarize(JSON.parse(readFileSync(join(this.#dir, n), 'utf8')));
      } catch {
        return fail('INVALID_JSON', `report file ${n} is not valid JSON`);
      }
    });
    return out
      .filter((s) => filter.gameId === undefined || s.gameId === filter.gameId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.reportId.localeCompare(b.reportId));
  }
}

/** Not wired anywhere. A later, reviewed step may implement this against TigerData. */
export class TigerDataStorage {
  async saveReport() { throw new Error('TigerDataStorage is not implemented'); }
  async listReports() { throw new Error('TigerDataStorage is not implemented'); }
  async getReport() { throw new Error('TigerDataStorage is not implemented'); }
}

/** Result-returning view of any ReportStorage: every method gives { ok, value } or an error result. */
export function safeStorage(storage) {
  return {
    saveReport: safely((r) => storage.saveReport(r)),
    listReports: safely((f) => storage.listReports(f)),
    getReport: safely((id) => storage.getReport(id)),
  };
}
