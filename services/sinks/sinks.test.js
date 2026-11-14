import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSinks, matchRows } from './index.js';

const result = (winner, seed) => ({
  config: { seed, dataHash: 'h1', options: { assignments: { p1: 'real_armor', p2: 'bari' } } },
  outcome: { winner }, durationTicks: 900, valid: true,
});

function fakeDrivers({ failMongo = false } = {}) {
  const mongoDocs = [];
  const sql = [];
  const load = async name => {
    if (name === 'mongodb') {
      return { MongoClient: class {
        async connect() { if (failMongo) throw Error('ECONNREFUSED'); }
        db() { return { collection: kind => ({ insertOne: async doc => mongoDocs.push({ kind, doc }) }) }; }
        async close() {}
      } };
    }
    return { default: { Pool: class {
      async query(text, values) { sql.push({ text, values }); return { rows: [] }; }
      async end() {}
    } } };
  };
  return { load, mongoDocs, sql };
}

test('nothing is enabled without connection strings', () => {
  const sinks = createSinks({}, async () => { throw Error('must not load a driver'); });
  assert.deepEqual(sinks.enabled, []);
  sinks.emit('version', { dataHash: 'x' });
});

test('match rows carry the matchup and the winning hero', () => {
  const rows = matchRows('matches', { results: [result('p2', 1), result('p1', 2)], runId: 'r1', phase: 'baseline' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].matchup, 'bari vs real_armor');
  assert.equal(rows[0].winner_hero, 'bari');
  assert.equal(rows[1].winner_hero, 'real_armor');
  assert.equal(rows[0].data_hash, 'h1');
});

test('documents go to MongoDB and match rows to Tiger Data', async () => {
  const fake = fakeDrivers();
  const sinks = createSinks({ MONGODB_URI: 'mongodb://x', TIGER_DATABASE_URL: 'postgres://y' }, fake.load);
  sinks.emit('version', { dataHash: 'h2' });
  sinks.emit('matches', { results: [result('p2', 1)], runId: 'r1' });
  await sinks.flush();
  assert.deepEqual(fake.mongoDocs.map(d => d.kind), ['version']);
  assert.ok(fake.sql.some(q => q.text.startsWith('INSERT INTO match_results')));
  assert.equal(sinks.status.mongodb.written, 1); // match rows are skipped, not counted
  assert.equal(sinks.status.tiger.failed, 0);
});

test('a failing store is counted and never throws', async () => {
  const fake = fakeDrivers({ failMongo: true });
  const sinks = createSinks({ MONGODB_URI: 'mongodb://x' }, fake.load);
  assert.doesNotThrow(() => sinks.emit('report', { a: 1 }));
  await sinks.flush();
  assert.equal(sinks.status.mongodb.failed, 1);
  assert.match(sinks.status.mongodb.lastError, /ECONNREFUSED/);
});

test('logged errors never contain a connection string or host', async () => {
  const lines = [];
  const load = async () => ({ MongoClient: class {
    async connect() { throw Error('connect failed for mongodb+srv://user:pw@cluster0.abc.mongodb.net/x'); }
    async close() {}
  } });
  const sinks = createSinks({ MONGODB_URI: 'mongodb://x' }, load, m => lines.push(m));
  sinks.emit('report', {});
  await sinks.flush();
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /mongodb\+srv|cluster0|pw@/);
  assert.match(lines[0], /<uri>/);
});

test('with a CA, ssl* URL parameters are removed so the CA is not replaced', async () => {
  const { withoutSslParams } = await import('./index.js');
  const out = withoutSslParams('postgres://u:p@h.example:31196/tsdb?sslmode=require&sslrootcert=x&application_name=bf');
  assert.equal(out, 'postgres://u:p@h.example:31196/tsdb?application_name=bf');
});
