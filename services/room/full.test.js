import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validate } from '../../packages/contracts/index.js';
import { localServer, http } from './test-helpers.js';
const fullAvailable = existsSync(new URL('../../packages/analysis/pipeline/full.js', import.meta.url));
test('full playtest awaits the real analysis module rather than fabricating dashboard reports', async t => {
  const {
    server
  } = await localServer(t);
  if (fullAvailable) {
    const pipeline = await import('../../packages/analysis/pipeline/full.js');
    assert.equal(typeof pipeline.runFull, 'function');
    return;
  }
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST',
    body: {
      gameId: 'hero_arena'
    }
  });
  assert.equal(response.status, 503);
  assert.equal(response.json().code, 'TRANSPORT_UNAVAILABLE');
  assert.equal(server.runningBatch, false);
});
test('a thin roster scan is a fair result: baseline only, no proposal, no holdout phase', {
  todo: fullAvailable ? false : 'Waiting for packages/analysis/pipeline/full.js as explicitly requested.'
}, async t => {
  if (!fullAvailable) return;
  const {
    server,
    host,
    room
  } = await localServer(t);
  host.request('match.start', {
    maxTicks: 1
  });
  server.advance(room);
  const originalHash = server.storage.get('hero_arena').dataHash;
  const versionsBefore = server.storage.versionStore.list('hero_arena').length;
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 2,
      holdoutPairs: 2,
      roster: true
    }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.fair, true); // 4 games per matchup: under 30 there is no outlier
  assert.equal(body.proposal, null);
  assert.equal(body.patched, null);
  assert.equal(body.patchedDataHash, null);
  assert.deepEqual(body.verdict, { verdict: 'inconclusive',
    reasons: ['no outlier: the matchup is within the fair band'] });
  validate('Report', body.baseline);
  assert.equal(body.humanMatches, 1);
  assert.equal(body.baseline.humanMatches, 1);
  assert.equal(server.storage.get('hero_arena').dataHash, originalHash);
  assert.equal(server.storage.versionStore.list('hero_arena').length, versionsBefore); // no version was recorded
  const baseline = JSON.parse(await readFile(join(server.storage.directory, 'playtests',
    `${body.runId}-baseline.json`), 'utf8'));
  assert.equal(baseline.length, 60);
  const final = host.messages.filter(message => message.type === 'playtest.progress' &&
    message.payload.phase === 'baseline').at(-1).payload;
  assert.equal(final.matchesDone, baseline.length);
  assert.equal(final.matchups.length, 15);
  assert.equal(body.seatWins.holdout, null);
  const phases = new Set(host.messages.filter(e => e.type === 'playtest.progress').map(e => e.payload.phase));
  assert.deepEqual([...phases], ['baseline']);
});
test('full playtest for one flagged hero pair streams baseline and disjoint holdout phases', {
  todo: fullAvailable ? false : 'Waiting for packages/analysis/pipeline/full.js as explicitly requested.'
}, async t => {
  if (!fullAvailable) return;
  const { server, host } = await localServer(t);
  const originalHash = server.storage.get('hero_arena').dataHash;
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST',
    body: { gameId: 'hero_arena', heroes: ['bari', 'daewi'], pairs: 15, holdoutPairs: 15 }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.fair, false); // 30 games, Bari wins about all of them
  assert.equal(body.proposal.origin, 'fake');
  assert.equal(body.validation.ok, true);
  validate('Report', body.baseline);
  validate('Report', body.patched);
  assert.deepEqual(body.baseline.rows.map(row => row.dimension), ['bari vs daewi']);
  assert.ok(body.proposal.changes.every(change => typeof change.old === 'number' && typeof change.new === 'number'));
  assert.equal(server.storage.get('hero_arena').dataHash, originalHash);
  assert.equal(server.storage.get('hero_arena', body.patchedDataHash).dataHash, body.patchedDataHash);
  const records = async phase => JSON.parse(await readFile(join(server.storage.directory, 'playtests',
    `${body.runId}-${phase}.json`), 'utf8'));
  const baseline = await records('baseline'),
    holdout = await records('holdout');
  assert.equal(baseline.length, 30);
  assert.equal(holdout.length, 30);
  const baselineSeeds = new Set(baseline.map(result => result.config.seed));
  assert.ok(holdout.every(result => !baselineSeeds.has(result.config.seed)));
  for (const [phase, results] of [['baseline', baseline], ['holdout', holdout]]) {
    const final = host.messages.filter(message => message.type === 'playtest.progress' &&
      message.payload.phase === phase).at(-1).payload;
    assert.equal(final.matchesDone, results.length);
    assert.equal(final.matchups.length, 1);
    assert.equal(body.seatWins[phase], results.filter(result => result.outcome.winners.includes(result.config.players[
      0])).length);
  }
  assert.notEqual(body.baseline.dataHash, body.patchedDataHash);
  assert.ok(['accepted', 'rejected', 'inconclusive'].includes(body.verdict.verdict));
  const phases = new Set(host.messages.filter(e => e.type === 'playtest.progress').map(e => e.payload.phase));
  assert.deepEqual([...phases].sort(), ['baseline', 'holdout']);
});
test('heroes picks one matchup on run and full; bad pairs get their own error codes', async t => {
  const { server } = await localServer(t);
  const post = (path, body) => http(server, path, { method: 'POST', body });
  const run = await post('/v1/playtest/run', { gameId: 'hero_arena', heroes: ['sepia', 'nightcrow'], pairs: 2 });
  assert.equal(run.status, 200);
  assert.equal(run.json().matchCount, 4);
  const results = await http(server, run.json().resultsPath);
  assert.deepEqual([...new Set(results.json().map(result => Object.values(result.config.options.assignments)
    .sort().join(' vs ')))], ['nightcrow vs sepia']);
  const full = await post('/v1/playtest/full', { gameId: 'hero_arena', heroes: ['sepia', 'nightcrow'], pairs: 2 });
  assert.equal(full.status, 200);
  assert.equal(full.json().fair, true);
  for (const path of ['/v1/playtest/run', '/v1/playtest/full']) {
    const mirror = await post(path, { gameId: 'hero_arena', heroes: ['bari', 'bari'], pairs: 2 });
    assert.equal(mirror.status, 400);
    assert.equal(mirror.json().code, 'MIRROR_MATCHUP');
    const unknown = await post(path, { gameId: 'hero_arena', heroes: ['bari', 'nobody'], pairs: 2 });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json().code, 'HERO_NOT_PLAYABLE');
    const both = await post(path, { gameId: 'hero_arena', heroes: ['bari', 'daewi'], roster: true, pairs: 2 });
    assert.equal(both.status, 400);
    assert.equal(both.json().code, 'INVALID_SCHEMA');
    for (const heroes of [['bari'], ['bari', 'daewi', 'sepia'], 'bari', [1, 2]]) {
      assert.equal((await post(path, { gameId: 'hero_arena', heroes, pairs: 2 })).status, 400);
    }
  }
  assert.equal(server.runningBatch, false);
});
test('run endpoint accepts roster scans and an explicit retained content pin', async t => {
  const {
      server
    } = await localServer(t),
    original = server.storage.get('hero_arena');
  server.storage.patch('hero_arena', {
    baseDataHash: original.dataHash,
    replacements: [{
      path: '/moves/1/power',
      value: 72
    }],
    rationale: 'test'
  });
  const response = await http(server, '/v1/playtest/run', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 1,
      roster: true,
      dataHash: original.dataHash
    }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().matchCount, 30);
  assert.equal(response.json().dataHash, original.dataHash);
});
test('playtest boundaries reject unknown fields, invalid pins and unsupported full game IDs', async t => {
  const {
    server
  } = await localServer(t);
  for (const body of [{
    gameId: 'hero_arena',
    pairs: 0
  }, {
    gameId: 'hero_arena',
    roster: 'yes'
  }, {
    gameId: 'hero_cards'
  }, {
    gameId: 'hero_arena',
    code: 'no'
  }]) {
    assert.equal((await http(server, '/v1/playtest/full', {
      method: 'POST',
      body
    })).status, 400);
  }
  assert.equal((await http(server, '/v1/playtest/run', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 1,
      dataHash: 'bad'
    }
  })).status, 400);
  assert.equal(server.runningBatch, false);
});
test('full playtest accepts a retained data pin and preserves numeric seat-win summaries', async t => {
  const { server } = await localServer(t);
  const original = server.storage.get('hero_arena');
  const changed = server.storage.patch('hero_arena', {
    baseDataHash: original.dataHash,
    replacements: [{ path: '/moves/1/power', value: 72 }],
    rationale: 'Retained-version test'
  });
  assert.notEqual(changed.dataHash, original.dataHash);
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', dataHash: original.dataHash, pairs: 2, holdoutPairs: 2 }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.baseline.dataHash, original.dataHash);
  assert.equal(typeof body.seatWins.baseline, 'number');
  assert.ok(body.seatWins.holdout === null || typeof body.seatWins.holdout === 'number');
  assert.equal(server.storage.get('hero_arena').dataHash, changed.dataHash);
});
test('pipeline failures retain their public code and readable message in HTTP responses', async t => {
  const { PipelineError } = await import('./playtests.js');
  const { server } = await localServer(t);
  server.handleHttp = async () => {
    throw new PipelineError({ code: 'SIMULATION_FAILED', message: 'The holdout run could not complete.' });
  };
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena' }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), {
    code: 'SIMULATION_FAILED', message: 'The holdout run could not complete.'
  });
});
test('real pipeline validation errors pass through the full route without generic transport masking', async t => {
  const { server } = await localServer(t);
  server.storage.humans = [{}];
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', pairs: 1, holdoutPairs: 1 }
  });
  assert.equal(response.status, 400);
  const body = response.json();
  assert.equal(body.code, 'INVALID_INPUT');
  assert.ok(body.message.includes('human results'));
  assert.equal(server.runningBatch, false);
});
test('diagnose: true measures both heroes against every other hero and streams phase diagnose', {
  todo: fullAvailable ? false : 'Waiting for packages/analysis/pipeline/full.js as explicitly requested.'
}, async t => {
  if (!fullAvailable) return;
  const { server, host } = await localServer(t);
  const response = await http(server, '/v1/playtest/full', {
    method: 'POST',
    body: { gameId: 'hero_arena', heroes: ['bari', 'daewi'], pairs: 15, holdoutPairs: 15, diagnose: true }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  const d = body.diagnosis;
  assert.equal(d.matchup, 'bari vs daewi');
  assert.ok(['overall_strong', 'overall_weak', 'counter_specific'].includes(d.classification));
  assert.deepEqual(d.heroes.map(hero => hero.hero).sort(), ['bari', 'daewi']);
  assert.ok(d.heroes.every(hero => hero.opponents.length === 4)); // the three other heroes plus the flagged partner
  assert.ok(d.heroes.every(hero => ['winner', 'loser'].includes(hero.strength.role)));
  assert.ok(d.recommendations.length >= 1);
  assert.ok(d.recommendations.every(rec => typeof rec.path === 'string' && ['up', 'down'].includes(rec.direction)));
  assert.equal(d.focusHero, d.recommendations[0].hero);
  const diagnose = JSON.parse(await readFile(join(server.storage.directory, 'playtests',
    `${body.runId}-diagnose.json`), 'utf8'));
  assert.equal(diagnose.length, 6 * 30); // 6 matchups, 15 pairs each, both seat orders
  const used = new Set(diagnose.map(result => result.config.seed));
  const others = [...JSON.parse(await readFile(join(server.storage.directory, 'playtests',
    `${body.runId}-baseline.json`), 'utf8')), ...JSON.parse(await readFile(join(server.storage.directory,
    'playtests', `${body.runId}-holdout.json`), 'utf8'))].map(result => result.config.seed);
  assert.ok(others.every(seed => !used.has(seed))); // fresh seeds, disjoint from baseline and holdout
  const phases = new Set(host.messages.filter(e => e.type === 'playtest.progress').map(e => e.payload.phase));
  assert.deepEqual([...phases].sort(), ['baseline', 'diagnose', 'holdout']);
  const final = host.messages.filter(message => message.type === 'playtest.progress' &&
    message.payload.phase === 'diagnose').at(-1).payload;
  assert.equal(final.matchesDone, diagnose.length);
  assert.equal(final.matchups.length, 6);
});
test('without diagnose the body has no diagnosis, and a fair matchup never runs one', async t => {
  const { server } = await localServer(t);
  const plain = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', heroes: ['bari', 'daewi'], pairs: 15, holdoutPairs: 15 }
  });
  assert.equal(plain.json().diagnosis, null);
  const fair = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', heroes: ['bari', 'daewi'], pairs: 2, diagnose: true }
  });
  assert.equal(fair.json().fair, true);
  assert.equal(fair.json().diagnosis, null);
  assert.equal((await http(server, '/v1/playtest/full', { method: 'POST',
    body: { gameId: 'hero_arena', diagnose: 'yes' } })).status, 400);
});
test('holdoutPairs defaults to pairs, and a thin holdout says so in the verdict reasons', {
  todo: fullAvailable ? false : 'Waiting for packages/analysis/pipeline/full.js as explicitly requested.'
}, async t => {
  if (!fullAvailable) return;
  const { server } = await localServer(t);
  const lines = async runId => JSON.parse(await readFile(join(server.storage.directory, 'playtests',
    `${runId}-holdout.json`), 'utf8')).length;
  const same = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', heroes: ['bari', 'daewi'], pairs: 15 }
  });
  assert.equal(same.status, 200);
  const body = same.json();
  assert.equal(await lines(body.runId), 30); // no holdoutPairs: 15 pairs, 30 games, the same size as the baseline
  assert.equal(body.patched.validMatches, body.baseline.validMatches);
  assert.match(body.holdoutSeedSetId, /^holdout-1000001-1000015$/);
  const thin = await http(server, '/v1/playtest/full', {
    method: 'POST', body: { gameId: 'hero_arena', heroes: ['bari', 'daewi'], pairs: 15, holdoutPairs: 5 }
  });
  assert.equal(await lines(thin.json().runId), 10); // an explicit holdoutPairs is still honoured
  assert.equal(thin.json().verdict.verdict, 'inconclusive');
  assert.match(thin.json().verdict.reasons.join('; '), /bari vs daewi: holdout has 10 games; 200 needed/);
});
