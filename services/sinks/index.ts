// Optional outside stores for run data: MongoDB Atlas keeps documents (versions, reports, runs),
// Tiger Data (Postgres/Timescale) keeps one row per match as a time series.
// Both are off unless their connection string is set, and neither can slow or break a run:
// writes are queued, each has a time limit, and failures are counted, never thrown.

// Cloud stores can take a few seconds for the first TLS connection from venue Wi-Fi.
// Writes never block a run, so a generous limit costs nothing.
const LIMIT_MS = 8000;

// Error text can contain a host or a connection string; keep only the code and a short,
// redacted message for the server log.
export function redact(error) {
  const text = String(error?.code ?? '') + ' ' + String(error?.message ?? error ?? '');
  return text.replace(/[a-z+]+:\/\/\S+/gi, '<uri>').replace(/@[\w.-]+/g, '@<host>').trim().slice(0, 160);
}

const withLimit = (promise, ms = LIMIT_MS) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error('TIMEOUT')), ms).unref())]);

export function matchRows(kind, payload) {
  // One flat row per match: what the time-series store and its charts need.
  if (kind !== 'matches') return [];
  const { results, dataHash, botPolicyVersion, phase, runId } = payload;
  return (results ?? []).map(r => {
    const a = r.config?.options?.assignments ?? {};
    const heroes = Object.values(a).sort();
    // MatchResult.outcome is { status: 'win' | 'draw', winners: [playerId] }.
    const winners = r.outcome?.winners ?? (r.outcome?.winner ? [r.outcome.winner] : []);
    const winnerHero = r.outcome?.status === 'win' && winners.length === 1 ? a[winners[0]] ?? null : null;
    return {
      at: new Date(payload.at ?? Date.now()),
      run_id: runId ?? null,
      phase: phase ?? null,
      data_hash: dataHash ?? r.config?.dataHash ?? null,
      bot_policy: botPolicyVersion ?? null,
      matchup: heroes.join(' vs '),
      winner_hero: winnerHero,
      ticks: r.durationTicks ?? r.statistics?.durationTicks ?? null,
      valid: r.valid !== false,
      seed: r.config?.seed ?? null,
    };
  });
}

function mongoSink(uri, load) {
  let client = null;
  const db = async () => {
    if (!client) {
      const { MongoClient } = await load('mongodb');
      // Shorter than LIMIT_MS so the driver's own reason (e.g. server selection) reaches the log.
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
      await client.connect();
    }
    return client.db('balance_forge');
  };
  return {
    name: 'mongodb',
    async write(kind, payload) {
      if (kind === 'matches') return 'skipped'; // match rows go to the time-series store
      try {
        await (await db()).collection(kind).insertOne({ ...payload, storedAt: new Date() });
      } catch (error) {
        // Drop a broken client so the next write reconnects instead of waiting on it.
        const old = client;
        client = null;
        old?.close().catch(() => {});
        throw error;
      }
    },
    async close() {
      await client?.close();
    },
  };
}

// pg rebuilds its TLS settings from ssl* URL parameters, which would replace the CA we pass.
export function withoutSslParams(url) {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) if (key.toLowerCase().startsWith('ssl')) u.searchParams.delete(key);
  return u.toString();
}

function tigerSink(url, load, ca) {
  let pool = null;
  const ready = async () => {
    if (!pool) {
      const { default: pg } = await load('pg');
      // With the provider's CA certificate (TIGER_CA_CERT, PEM text) the server is fully verified;
      // TLS verification is never switched off here.
      pool = new pg.Pool({ connectionString: ca ? withoutSslParams(url) : url, max: 2,
        connectionTimeoutMillis: LIMIT_MS,
        ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });
      await pool.query(`CREATE TABLE IF NOT EXISTS match_results (
        at timestamptz NOT NULL, run_id text, phase text, data_hash text, bot_policy text,
        matchup text, winner_hero text, ticks integer, valid boolean, seed bigint)`);
      // Hypertable when the server has TimescaleDB; a plain table still works without it.
      await pool.query(`SELECT create_hypertable('match_results', 'at', if_not_exists => TRUE)`).catch(() => {});
    }
    return pool;
  };
  return {
    name: 'tiger',
    async write(kind, payload) {
      const rows = matchRows(kind, payload);
      if (!rows.length) return 'skipped';
      const db = await ready();
      const cols = Object.keys(rows[0]);
      const values = rows.flatMap(r => cols.map(c => r[c]));
      const marks = rows.map((_, i) => `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`);
      await db.query(`INSERT INTO match_results (${cols.join(',')}) VALUES ${marks.join(',')}`, values);
    },
    async trend(matchup) {
      // Win share of the alphabetically first hero per data version, oldest first.
      const db = await ready();
      const first = matchup.split(' vs ')[0];
      const { rows } = await db.query(`SELECT data_hash, min(at) AS first_seen, count(winner_hero)::int AS games,
        avg((winner_hero = $2)::int)::float AS rate FROM match_results
        WHERE matchup = $1 AND valid AND winner_hero IS NOT NULL
        GROUP BY data_hash ORDER BY first_seen`, [matchup, first]);
      return rows;
    },
    async close() {
      await pool?.end();
    },
  };
}

/** Sinks from env (MONGODB_URI, TIGER_DATABASE_URL). `load` is injectable for tests. */
export function createSinks(env = process.env, load = name => import(name), log = m => console.warn(m)) {
  const sinks = [];
  if (env.MONGODB_URI) sinks.push(mongoSink(env.MONGODB_URI, load));
  if (env.TIGER_DATABASE_URL) sinks.push(tigerSink(env.TIGER_DATABASE_URL, load, env.TIGER_CA_CERT));
  const status = Object.fromEntries(sinks.map(s => [s.name, { written: 0, failed: 0, lastError: null }]));
  let queue = Promise.resolve();
  return {
    enabled: sinks.map(s => s.name),
    status,
    /** Fire and forget: never awaits the caller, never throws. */
    emit(kind, payload) {
      for (const sink of sinks) {
        queue = queue.then(() => withLimit(sink.write(kind, payload)))
          .then(result => { if (result !== 'skipped') status[sink.name].written += 1; })
          .catch(error => {
            status[sink.name].failed += 1;
            status[sink.name].lastError = redact(error);
            log(`sink ${sink.name} ${kind} failed: ${status[sink.name].lastError}`);
          });
      }
    },
    async trend(matchup) {
      const tiger = sinks.find(s => s.name === 'tiger');
      if (!tiger) return null;
      try {
        return await withLimit(tiger.trend(matchup));
      } catch (error) {
        log(`sink tiger trend failed: ${redact(error)}`);
        throw error;
      }
    },
    flush: () => queue,
    async close() {
      await queue;
      await Promise.allSettled(sinks.map(s => s.close()));
    },
  };
}
