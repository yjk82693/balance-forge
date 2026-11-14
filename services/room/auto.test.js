import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http } from './test-helpers.js';
import { autoSeeds } from './auto.js';
import { twoRoundAuto } from './auto-test-helpers.js';

test('auto seeds are disjoint across scan, holdout, rounds and a final check', () => {
  const all = [];
  for (let round = 1; round <= 6; round++) for (const phase of ['scan', 'holdout']) {
    const seeds = autoSeeds(round, phase);
    assert.equal(seeds.length, 100);
    assert.deepEqual(seeds, autoSeeds(round, phase));
    all.push(...seeds);
  }
  assert.equal(new Set(all).size, all.length);
  assert.throws(() => autoSeeds(0, 'scan'), /INVALID_SCHEMA/);
});
test('two injected auto rounds persist two child records, stream phases and play a selected older version', async t => {
  const { server, host, room } = await localServer(t, { runAuto: twoRoundAuto });
  const base = server.storage.get('hero_arena');
  const response = await http(server, '/v1/playtest/auto', {
    method: 'POST', body: { gameId: 'hero_arena', rounds: 2, requireApproval: false }
  });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.stoppedBecause, 'rounds');
  assert.equal(body.records.length, 2);
  assert.equal(body.records[0].parentHash, base.dataHash);
  assert.equal(body.records[1].parentHash, body.records[0].dataHash);
  assert.equal(server.storage.versionStore.list('hero_arena').length, 3);
  const progress = host.messages.filter(message => message.type === 'playtest.progress')
    .map(message => message.payload);
  assert.ok(progress.length >= 8);
  assert.deepEqual([...new Set(progress.map(update => `${update.round}:${update.phase}`))],
    ['1:scan', '1:holdout', '2:scan', '2:holdout']);
  assert.ok(progress.every(update => update.runId === body.runId));
  assert.equal(server.storage.get('hero_arena').dataHash, base.dataHash);
  const first = body.records[0].dataHash;
  assert.equal((await http(server, '/v1/data/hero_arena/select', {
    method: 'POST', body: { dataHash: first }
  })).status, 200);
  host.request('game.select', { gameId: 'hero_arena', dataHash: first });
  host.request('match.start', { maxTicks: 1 });
  assert.equal(room.authority.config.dataHash, first);
  server.advance(room);
  assert.equal(server.storage.humans[0].valid, true);
});
test('auto forwards defaults and approval pause; resuming branches from the requested version', async t => {
  const inputs = [];
  const { server } = await localServer(t, { runAuto: async input => {
    inputs.push(input);
    return twoRoundAuto(input);
  } });
  const first = await http(server, '/v1/playtest/auto', { method: 'POST', body: { gameId: 'hero_arena' } });
  assert.equal(first.status, 200);
  assert.equal(inputs[0].rounds, 3);
  assert.equal(inputs[0].requireApproval, true);
  assert.equal(first.json().stoppedBecause, 'awaiting_approval');
  const fromHash = first.json().records[0].dataHash;
  const resumed = await http(server, '/v1/playtest/auto', {
    method: 'POST', body: { gameId: 'hero_arena', fromHash, rounds: 1 }
  });
  assert.equal(resumed.status, 200);
  assert.equal(inputs[1].fromHash, fromHash);
  assert.equal(inputs[1].hashData(inputs[1].data), fromHash);
});
test('auto rejects malformed requests and shares the run/full concurrency lock', async t => {
  let release, calls = 0;
  const { server } = await localServer(t, { runAuto: () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  } });
  for (const body of [{}, { gameId: 'hero_arena', rounds: 6 }, { gameId: 'hero_arena', requireApproval: 1 },
    { gameId: 'hero_arena', fromHash: '../invalid' }]) {
    assert.equal((await http(server, '/v1/playtest/auto', { method: 'POST', body })).status, 400);
  }
  assert.equal(calls, 0);
  const running = http(server, '/v1/playtest/auto', { method: 'POST', body: { gameId: 'hero_arena' } });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  for (const route of ['auto', 'run', 'full']) {
    const response = await http(server, `/v1/playtest/${route}`, {
      method: 'POST', body: { gameId: 'hero_arena', pairs: 1 }
    });
    assert.equal(response.status, 429);
    assert.equal(response.json().code, 'RATE_LIMITED');
  }
  release({ records: [], stoppedBecause: 'fair', finalCheck: null });
  assert.equal((await running).status, 200);
  assert.equal(server.runningBatch, false);
});
test('an auto pipeline rejection releases the concurrency lock', async t => {
  const { server } = await localServer(t, { runAuto: async () => { throw Error('INVALID_SCHEMA'); } });
  const response = await http(server, '/v1/playtest/auto', { method: 'POST', body: { gameId: 'hero_arena' } });
  assert.equal(response.status, 400);
  assert.equal(server.runningBatch, false);
});
test('needs_designer notes are validated, returned and stored with the run so a later GET shows them', async t => {
  const note = { hero: 'daewi', round: 1, matchups: ['bari vs daewi'],
    evidence: 'daewi wins 10.0% overall. 3 levers tried.',
    tried: [{ label: 'Daewi · Speed', path: '/characters/1/speed', old: 85, new: 110, outcome: 'rejected' },
      { label: 'Daewi · Health', path: '/characters/1/health', old: 580, new: 754, outcome: 'skipped',
        reason: 'this version was already tried' }, { label: '/moves/1/power', path: '/moves/1/power', old: null,
        new: null, outcome: 'skipped' }] };
  const { server } = await localServer(t, { runAuto: async () => ({ records: [], stoppedBecause: 'needs_designer',
    finalCheck: null, needs_designer: [note] }) });
  const response = await http(server, '/v1/playtest/auto', { method: 'POST', body: { gameId: 'hero_arena' } });
  assert.equal(response.status, 200);
  const body = response.json();
  assert.equal(body.stoppedBecause, 'needs_designer');
  assert.deepEqual(body.needs_designer, [note]);
  assert.equal(server.storage.versionStore.list('hero_arena').length, 1); // a note is not a version record
  const stored = await http(server, `/v1/playtest/results/${body.runId}-auto.json`);
  assert.equal(stored.status, 200);
  assert.deepEqual(stored.json().needs_designer, [note]);
  assert.equal(stored.json().runId, body.runId);
});
test('a run without needs_designer gets an empty list, and a malformed note is refused', async t => {
  const plain = await localServer(t, { runAuto: async () => ({ records: [], stoppedBecause: 'fair',
    finalCheck: null }) });
  const ok = await http(plain.server, '/v1/playtest/auto', { method: 'POST', body: { gameId: 'hero_arena' } });
  assert.deepEqual(ok.json().needs_designer, []);
  for (const bad of [[{ hero: 'daewi' }], [{ hero: 'daewi', tried: [{ path: '/x', outcome: 'maybe' }], evidence: 'x' }],
    'nope']) {
    const broken = await localServer(t, { runAuto: async () => ({ records: [], stoppedBecause: 'needs_designer',
      finalCheck: null, needs_designer: bad }) });
    const response = await http(broken.server, '/v1/playtest/auto', { method: 'POST',
      body: { gameId: 'hero_arena' } });
    assert.equal(response.status, 400);
  }
});
test('the auto route gives runAuto an explain hook that replays the pair with the real engine', async t => {
  let sentence;
  const { server } = await localServer(t, { runAuto: async input => {
    sentence = await input.explain({ hero: 'daewi', matchup: 'daewi vs real_armor' });
    return { records: [], stoppedBecause: 'needs_designer', finalCheck: null, needs_designer: [{
      hero: 'daewi', tried: [], evidence: `Daewi was tried. ${sentence}` }] };
  } });
  const response = await http(server, '/v1/playtest/auto', { method: 'POST', body: { gameId: 'hero_arena' } });
  assert.equal(response.status, 200);
  assert.match(sentence, /^Replays of daewi vs real_armor: In range, daewi's swings landed \d+% \(interrupted \d+%/);
  assert.match(sentence, /of 40 replays never came within melee range \(1900\)/);
  assert.match(response.json().needs_designer[0].evidence, /Replays of daewi vs real_armor/);
});
