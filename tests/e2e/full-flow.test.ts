import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../services/room/server.ts';
import { twoRoundAuto } from '../../services/room/auto-test-helpers.ts';
import * as arena from '../../packages/games/action/index.ts';
import { chooseActions, chooseAction, deriveBotSeed, botPolicyVersion } from '../../packages/games/action/bot.ts';
import { compareIds, hash, validate } from '../../packages/contracts/index.ts';
import { replayOnData } from '../../packages/sim/index.ts';
const enabled = process.env.RUN_SOCKET_TESTS === '1';
const transientInputErrors = new Set(['LATE_INPUT', 'RATE_LIMITED']);
class Peer {
  declare socket: WebSocket;
  declare messages: any[];
  declare waiters: Set<any>;
  declare meta: { roomId: string; sessionId: string; epoch: number };
  declare requestSeq: number;
  declare requests: Map<string, any>;
  declare lastAck: number;
  declare seat: string | null;
  declare phase: string;
  declare botEnabled: boolean;
  declare botVariant: number;
  declare lastBotTick: number;
  declare accepted: number;
  declare submitted: number;
  declare failure: Error | null;
  declare closing: boolean;
  [key: string]: any;
  constructor(url: string) {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    this.socket = new WebSocket(url);
    this.messages = [];
    this.waiters = new Set();
    this.meta = {
      roomId: '',
      sessionId: '',
      epoch: 1
    };
    this.requestSeq = 0;
    this.requests = new Map();
    this.lastAck = -1;
    this.seat = null;
    this.phase = 'lobby';
    this.botEnabled = false;
    this.botVariant = 0;
    this.lastBotTick = -1;
    this.accepted = 0;
    this.submitted = 0;
    this.failure = null;
    this.closing = false;
    this.socket.on('error', error => this.fail(error));
    this.socket.on('close', () => {
      if (!this.closing) this.fail(Error('Unexpected WebSocket disconnect.'));
    });
    this.socket.on('message', raw => {
      try {
        this.receive(JSON.parse(raw.toString('utf8')));
      } catch (error) {
        this.fail(error);
      }
    });
  }
  fail(error) {
    this.failure ??= error;
    for (const notify of [...this.waiters]) notify();
  }
  receive(envelope) {
    this.messages.push(envelope);
    this.meta = envelope;
    if (envelope.type === 'room.status') {
      this.phase = envelope.payload.phase;
      this.seat = envelope.payload.you ?? this.seat;
    }
    if (envelope.type === 'match.started') {
      this.matchSeed = envelope.payload.config.seed;
      this.lastBotTick = -1;
      this.lastAck = -1;
    }
    if (envelope.type === 'input.ack') {
      this.lastAck = Math.max(this.lastAck, envelope.payload.seq);
      this.accepted++;
    }
    const endedInput = envelope.type === 'error' && envelope.payload.code === 'ILLEGAL_ACTION' &&
      this.phase === 'ended' && this.requests.get(envelope.requestId)?.type === 'input.submit';
    if (envelope.type === 'error' && !transientInputErrors.has(envelope.payload.code) && !endedInput) {
      this.fail(Error(`Server rejected a request: ${envelope.payload.code}`));
    }
    if (envelope.type === 'match.ended') this.botEnabled = false;
    if (envelope.type === 'state.view') this.drive(envelope);
    for (const notify of [...this.waiters]) notify();
  }
  send(type: string, payload: unknown): string {
    assert.equal(this.socket.readyState, WebSocket.OPEN);
    const requestId = `e2e-${++this.requestSeq}`;
    this.requests.set(requestId, {
      type,
      payload
    });
    this.socket.send(JSON.stringify({
      protocolVersion: '0.1',
      type,
      roomId: this.meta.roomId,
      sessionId: this.meta.sessionId,
      requestId,
      seq: this.requestSeq,
      epoch: this.meta.epoch,
      payload
    }));
    return requestId;
  }
  latest(type) {
    return this.messages.findLast(message => message.type === type);
  }
  waitFor(type: string, predicate: (message: any) => boolean = () => true, {
    after = 0,
    timeout = 10000
  } = {}): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      let timer;
      const finish = (error: Error | null, value?: any) => {
        clearTimeout(timer);
        this.waiters.delete(check);
        if (error) reject(error);else resolve(value);
      };
      const check = () => {
        if (this.failure) return finish(this.failure);
        const envelope = this.messages.slice(after).find(message => message.type === type && predicate(message));
        if (envelope) finish(null, envelope);
      };
      timer = setTimeout(() => finish(Error(`Timed out waiting for ${type}.`)), timeout);
      this.waiters.add(check);
      check();
    });
  }
  startBot(variant) {
    this.botVariant = variant;
    this.botEnabled = true;
    this.lastBotTick = -1;
    const view = this.latest('state.view');
    if (view?.epoch === this.meta.epoch) this.drive(view);
  }
  drive(envelope) {
    if (!this.botEnabled || !this.seat || this.phase !== 'playing' || this.socket.readyState !== WebSocket.OPEN) return;
    const view = envelope.payload.observation;
    if (view.tick <= this.lastBotTick) return;
    this.lastBotTick = view.tick;
    for (const input of chooseActions(view, view.tick * 2, deriveBotSeed(this.matchSeed, this.botVariant))) {
      this.send('input.submit', input);
      this.submitted++;
    }
  }
  async drop() {
    this.closing = true;
    this.botEnabled = false;
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        reject(Error('Socket close timed out.'));
      }, 2000);
      this.socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.close(1000, 'e2e reconnect');
    });
  }
  dispose() {
    this.closing = true;
    this.botEnabled = false;
    this.fail(Error('Test cleanup closed the connection.'));
    this.socket.terminate();
  }
}
async function analysisModules() {
  try {
    const [pipeline, adapter, humans, replay, simulator] = await Promise.all([import(
      '../../packages/analysis/pipeline/pipeline.ts'), import('../../packages/analysis/src/adapter.ts'), import(
      '../../packages/analysis/src/human.ts'), import('../../packages/analysis/src/replay.ts'), import(
      '../../packages/analysis/pipeline/arena-simulator.ts')]);
    return {
      ...pipeline,
      ...adapter,
      ...humans,
      ...replay,
      ...simulator
    };
  } catch (error) {
    assert.fail(`Analysis pipeline is unavailable; merge packages/analysis before test:e2e. ${error.message}`);
  }
}
async function setup(t: any, { runAuto }: { runAuto?: (...args: any[]) => any } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'balance-full-flow-'));
  const peers = [];
  let server;
  t.after(async () => {
    for (const peer of peers) peer.dispose();
    try {
      if (server) await server.close();
    } finally {
      await rm(directory, {
        recursive: true,
        force: true
      });
    }
  });
  const storageDir = join(directory, 'room'),
    staticDir = join(directory, 'dist');
  await mkdir(staticDir);
  await writeFile(join(staticDir, 'index.html'), '<h1>E2E local fixture</h1>');
  server = createRoomServer({
    storageDir,
    staticDir,
    workers: 2,
    runAuto,
    analysisEnv: {}
  });
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = async (path: string, body?: unknown) => {
    const url = new URL(path, origin);
    assert.equal(url.origin, origin, 'Every HTTP request must stay on this loopback server.');
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
      ...(body === undefined ? {} : {
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      })
    });
    const json = await response.json();
    assert.ok(response.ok, `${url.pathname} returned HTTP ${response.status}: ${json.code ?? 'unknown error'}`);
    return json;
  };
  const connect = async () => {
    const peer = new Peer(origin.replace('http:', 'ws:') + '/ws');
    peers.push(peer);
    await peer.waitFor('room.status');
    return peer;
  };
  return {
    server,
    directory,
    storageDir,
    request,
    connect
  };
}
async function joinPhone(phone, joinCode, hero) {
  const requestId = phone.send('room.join', {
    joinCode,
    name: `E2E ${hero}`,
    hero
  });
  return phone.waitFor('room.status', message => message.requestId === requestId && !!message.payload.you);
}
function assertProgress(updates, results) {
  assert.ok(updates.length >= 2, 'Expect initial and final progress snapshots.');
  assert.equal(updates[0].matchesDone, 0);
  for (let index = 0; index < updates.length; index++) {
    const update = updates[index];
    assert.equal(update.totalMatches, results.length);
    assert.ok(update.matchesDone <= update.totalMatches);
    if (index) {
      assert.ok(update.matchesDone >= updates[index - 1].matchesDone);
      assert.ok(update.elapsedMs >= updates[index - 1].elapsedMs);
    }
  }
  const final = updates.at(-1);
  assert.equal(final.matchesDone, results.length);
  assert.equal(final.matchups.reduce((count, row) => count + row.games + row.invalidMatches, 0), results.length);
  const actualWins = {};
  for (const result of results) for (const winner of result.outcome.winners) {
    const hero = result.config.options.assignments[winner];
    actualWins[hero] = (actualWins[hero] ?? 0) + 1;
  }
  const reportedWins = {};
  for (const row of final.matchups) for (const [hero, wins] of Object.entries(row.wins)) {
    reportedWins[hero] = (reportedWins[hero] ?? 0) + wins;
  }
  for (const hero of Object.keys(reportedWins)) assert.equal(reportedWins[hero], actualWins[hero] ?? 0);
  assert.equal(final.matchups.reduce((count, row) => count + row.draws, 0), results.filter(result =>
    result.outcome.status === 'draw').length);
}
async function playtest(request, display, pairs, dataHash) {
  const after = display.messages.length;
  const run = await request('/v1/playtest/run', {
    gameId: 'hero_arena',
    pairs
  });
  assert.equal(run.dataHash, dataHash);
  assert.ok(run.elapsedMs > 0);
  const results = await request(run.resultsPath);
  assert.equal(results.length, pairs * 2);
  assert.equal(run.matchCount, results.length);
  for (const result of results) {
    validate('MatchResult', result);
    assert.equal(result.valid, true);
    assert.equal(result.config.dataHash, dataHash);
  }
  const ended = await display.waitFor('playtest.progress', message =>
    message.payload.matchesDone === results.length && message.payload.dataHash === dataHash, {
    after
  });
  const updates = display.messages.slice(after).filter(message => message.type === 'playtest.progress' &&
    message.payload.runId === ended.payload.runId).map(message => message.payload);
  assertProgress(updates, results);
  return {
    run,
    results
  };
}
async function analyzeAndPatch(context, display, humans, baseline, original, analysis) {
  const options = {
    reportId: 'e2e-baseline',
    botPolicyVersion,
    seedSetId: 'e2e-seeds-1-20'
  };
  const phase = analysis.analyzePhase(baseline.results, options);
  const before = analysis.addHumanRows(phase.report, humans, options);
  assert.ok(before.humanMatches >= 1);
  validate('Report', before);
  const adapter = new analysis.FakePatchAdapter({
    baseDataHash: original.dataHash,
    replacements: [{
      path: '/moves/1/power',
      value: 72
    }],
    rationale: 'E2E offline numeric proposal; not a balance recommendation.'
  });
  const proposed = await analysis.proposeStep(before, adapter, {
    moveCount: original.data.moves.length
  });
  assert.equal(proposed.ok, true);
  assert.equal(proposed.origin, 'fake');
  validate('PatchProposal', proposed.proposal);
  const applied = await context.request('/v1/data/hero_arena/apply-patch', {
    proposal: proposed.proposal
  });
  assert.notEqual(applied.dataHash, original.dataHash);
  const patched = await context.request('/v1/data/hero_arena');
  assert.equal(patched.dataHash, applied.dataHash);
  assert.equal(hash(patched.data), applied.dataHash);
  assert.deepEqual(await context.request(`/v1/data/hero_arena?dataHash=${original.dataHash}`), original);
  // The API has a seed prefix, not a seed range: use only 21..40 as the untouched holdout.
  const candidate = await playtest(context.request, display, 40, applied.dataHash);
  const holdout = candidate.results.filter(result => result.config.seed > 20);
  assert.equal(holdout.length, 40);
  const trainingSeeds = new Set(baseline.results.map(result => result.config.seed));
  assert.ok(holdout.every(result => !trainingSeeds.has(result.config.seed)));
  const verification = analysis.verifyStep(before, holdout, {
    reportId: 'e2e-holdout',
    botPolicyVersion,
    seedSetId: 'e2e-seeds-21-40'
  });
  assert.ok(['accepted', 'rejected', 'inconclusive'].includes(verification.verdict.verdict));
  const report = analysis.addHumanRows(verification.report, humans);
  assert.ok(report.humanMatches >= 1);
  validate('Report', report);
  const artifacts = {
    'report_baseline.json': before,
    'proposal.json': proposed.proposal,
    'report_patched.json': report,
    'verdict.json': verification.verdict
  };
  for (const [name, value] of Object.entries(artifacts)) {
    await writeFile(join(context.directory, name), JSON.stringify(value, null, 2));
  }
  return {
    patched,
    proposal: proposed.proposal
  };
}
async function fullDashboard(context, display, dataHash) {
  const after = display.messages.length;
  // One lopsided pair (40 games): enough for an outlier, so a patch is proposed. A fair one stops at the baseline.
  const body = await context.request('/v1/playtest/full', {
    gameId: 'hero_arena',
    heroes: ['bari', 'daewi'],
    pairs: 20,
    holdoutPairs: 20
  });
  assert.equal(body.gameId, 'hero_arena');
  assert.equal(body.proposal.origin, 'fake');
  assert.equal(body.validation.ok, true);
  assert.deepEqual(body.validation.errors, []);
  validate('Report', body.baseline);
  validate('Report', body.patched);
  assert.equal(body.baseline.dataHash, dataHash);
  assert.equal(body.patched.dataHash, body.patchedDataHash);
  assert.notEqual(body.patchedDataHash, dataHash);
  assert.ok(body.humanMatches >= 1);
  assert.ok(body.baseline.humanMatches >= 1);
  assert.ok(body.proposal.changes.length > 0);
  assert.ok(body.proposal.changes.every(change => typeof change.old === 'number' && typeof change.new === 'number'));
  assert.ok(['accepted', 'rejected', 'inconclusive'].includes(body.verdict.verdict));
  const phaseResults: Record<string, any[]> = {};
  for (const phase of ['baseline', 'holdout']) {
    const results = await context.request(`/v1/playtest/results/${body.runId}-${phase}.json`);
    phaseResults[phase] = results;
    await display.waitFor('playtest.progress', message => message.payload.runId === body.runId &&
      message.payload.phase === phase && message.payload.matchesDone === results.length, {
      after
    });
    const updates = display.messages.slice(after).filter(message => message.type === 'playtest.progress' &&
      message.payload.runId === body.runId && message.payload.phase === phase).map(message => message.payload);
    assertProgress(updates, results);
    const seatWins = results.filter(result => result.outcome.winners.includes(result.config.players[0])).length;
    assert.equal(body.seatWins[phase], seatWins);
    assert.equal(updates.at(-1).seatWins, seatWins);
  }
  const baselineSeeds = new Set(phaseResults.baseline.map(result => result.config.seed));
  assert.ok(phaseResults.holdout.every(result => !baselineSeeds.has(result.config.seed)));
}
async function checkReplay(context, baseline, original, patched, proposal, analysis) {
  const result = baseline.results[0];
  const recording = await context.request(`/v1/replay/${result.matchId}`);
  assert.equal(recording.seed, result.config.seed);
  assert.deepEqual(recording.config, result.config);
  assert.equal(recording.frames.length, result.statistics.durationTicks);
  const views = await context.request(`/v1/replay/${result.matchId}/views?every=6`);
  assert.equal(views.finalStateHash, result.finalStateHash);
  const patchedViews = await context.request(`/v1/replay/${result.matchId}/views?dataHash=${patched.dataHash}&every=6`);
  assert.equal(patchedViews.dataHash, patched.dataHash);
  assert.ok(patchedViews.views.length > 0);
  assert.equal(hash(replayOnData(arena.adapter, recording, original.data)), result.finalStateHash);
  const candidate = replayOnData(arena.adapter, recording, patched.data);
  assert.equal(hash(candidate), hash(replayOnData(arena.adapter, recording, patched.data)));
  const simulator = analysis.createArenaSimulator({
    arena,
    chooseActions,
    chooseAction,
    hash,
    compareIds
  });
  // Supply archived frames to the analysis replay helper rather than regenerating controller arrival order.
  const simulate = ({
    config,
    data
  }) => {
    let state = arena.initial(config, data);
    const timeline = [{
      tick: 0,
      hp: Object.fromEntries(state.payload.entities.map(entity => [entity.id, entity.hp]))
    }];
    for (const frame of recording.frames) {
      state = arena.step(state, frame, data).state;
      timeline.push({
        tick: state.tick,
        hp: Object.fromEntries(state.payload.entities.map(entity => [entity.id, entity.hp]))
      });
    }
    return {
      outcome: arena.outcome(state),
      finalStateHash: hash(state),
      durationTicks: state.tick,
      timeline,
      heroes: Object.fromEntries(state.payload.entities.map(entity => [entity.id, entity.hero])),
      maxHp: Object.fromEntries(state.payload.entities.map(entity => [entity.id, entity.maxHp]))
    };
  };
  const replay = await analysis.buildBeforeAfter({
    baselineResult: result,
    baseData: original.data,
    proposal,
    simulate,
    hashData: simulator.hashData
  });
  assert.equal(replay.ok, true, replay.error?.message);
  assert.equal(replay.value.before.finalStateHash, result.finalStateHash);
  assert.equal(replay.value.after.dataHash, patched.dataHash);
  assert.equal(replay.value.after.finalStateHash, hash(candidate));
  await writeFile(join(context.directory, 'before_after.json'), JSON.stringify(replay.value, null, 2));
}
async function reconnectPhone(context, display, phoneA, phoneB, roomId, joinCode) {
  const resetId = display.send('match.reset', {});
  await display.waitFor('room.status', message => message.requestId === resetId && message.payload.phase === 'lobby');
  const after = display.messages.length;
  phoneA.startBot(0);
  phoneB.startBot(1);
  display.send('match.start', {
    seed: 29
  });
  const started = await display.waitFor('match.started', () => true, {
    after
  });
  await phoneA.waitFor('state.view', message => message.epoch === started.epoch && message.payload.tick >= 5);
  const status = phoneA.latest('room.status'),
    token = status.payload.seatToken,
    seat = status.payload.you;
  const lastAck = phoneA.lastAck,
    dropTime = performance.now();
  await phoneA.drop();
  await display.waitFor('room.status', message => message.epoch === started.epoch &&
    message.payload.phase === 'playing' && message.payload.seats.some(item => item.seat === seat && !item.connected), {
    after
  });
  const resumed = await context.connect();
  const requestId = resumed.send('reconnect', {
    joinCode,
    seatToken: token,
    ...(lastAck >= 0 ? {
      lastAck
    } : {})
  });
  const restored = await resumed.waitFor('room.status', message => message.requestId === requestId &&
    message.payload.you === seat);
  assert.ok(performance.now() - dropTime < 10000, 'Resume must complete inside the ten-second seat reservation.');
  assert.equal(restored.roomId, roomId);
  assert.equal(restored.epoch, started.epoch);
  assert.equal(restored.payload.seats.find(item => item.seat === seat).hero, 'bari');
  assert.ok(restored.payload.seatToken !== token, 'Resume must rotate the private token.');
  assert.deepEqual((await resumed.waitFor('match.started')).payload.config, started.payload.config);
  resumed.startBot(0);
  const ended = await display.waitFor('match.ended', () => true, {
    after,
    timeout: 40000
  });
  assert.equal(ended.payload.result.valid, true);
  assert.equal(ended.payload.result.config.seed, 29);
  await resumed.waitFor('match.ended', message => message.payload.result.matchId === ended.payload.result.matchId);
  assert.ok(resumed.submitted > 0 && resumed.lastAck > lastAck,
    'The resumed phone must receive a newer input receipt from the same authority.');
}
test('full live flow: phones, human record, worker progress, fake patch, holdout, replay and reconnect', {
  skip: enabled ? false : 'Requires RUN_SOCKET_TESTS=1 and localhost listener permission.',
  timeout: 120000
}, async t => {
  const analysis = await analysisModules();
  const context = await setup(t);
  const display = await context.connect();
  const createId = display.send('room.create', {
    gameId: 'hero_arena'
  });
  const created = await display.waitFor('room.status', message => message.requestId === createId);
  const {
      joinCode
    } = created.payload,
    roomId = created.roomId;
  assert.match(joinCode, /^[A-Z0-9]{4}$/);
  const phoneA = await context.connect(),
    phoneB = await context.connect();
  const joinedA = await joinPhone(phoneA, joinCode, 'bari'),
    joinedB = await joinPhone(phoneB, joinCode, 'real_armor');
  assert.equal(joinedA.payload.you, 'p1');
  assert.equal(joinedB.payload.you, 'p2');
  const humanPath = join(context.storageDir, 'human-results.json');
  const initialHumans = JSON.parse(await readFile(humanPath, 'utf8'));
  phoneA.startBot(0);
  phoneB.startBot(1);
  display.send('match.start', {
    seed: 1
  });
  const ended = await display.waitFor('match.ended', () => true, {
    timeout: 40000
  });
  const human = ended.payload.result;
  validate('MatchResult', human);
  assert.equal(human.valid, true);
  assert.deepEqual(human.config.options.assignments, {
    p1: 'bari',
    p2: 'real_armor'
  });
  assert.ok(phoneA.submitted > 0 && phoneB.submitted > 0);
  assert.ok(phoneA.accepted > 0 && phoneB.accepted > 0);
  const humans = JSON.parse(await readFile(humanPath, 'utf8'));
  assert.equal(humans.length, initialHumans.length + 1);
  assert.deepEqual(humans.at(-1), human);
  const original = await context.request('/v1/data/hero_arena');
  const baseline = await playtest(context.request, display, 20, original.dataHash);
  await fullDashboard(context, display, original.dataHash);
  const {
    patched,
    proposal
  } = await analyzeAndPatch(context, display, humans, baseline, original, analysis);
  await checkReplay(context, baseline, original, patched, proposal, analysis);
  await reconnectPhone(context, display, phoneA, phoneB, roomId, joinCode);
  assert.equal(display.failure, null);
  assert.equal(phoneB.failure, null);
});

test('two injected auto rounds create versions and a real room plays the selected first version', {
  skip: enabled ? false : 'Requires RUN_SOCKET_TESTS=1 and localhost listener permission.',
  timeout: 30000
}, async t => {
  const context = await setup(t, { runAuto: twoRoundAuto });
  const display = await context.connect();
  const createId = display.send('room.create', { gameId: 'hero_arena' });
  const created = await display.waitFor('room.status', message => message.requestId === createId);
  const first = await context.connect(), second = await context.connect();
  await joinPhone(first, created.payload.joinCode, 'bari');
  await joinPhone(second, created.payload.joinCode, 'real_armor');
  const run = await context.request('/v1/playtest/auto', {
    gameId: 'hero_arena', rounds: 2, requireApproval: false
  });
  assert.equal(run.records.length, 2);
  const versions = await context.request('/v1/versions/hero_arena');
  assert.equal(versions.versions.length, 3);
  assert.equal(run.records[1].parentHash, run.records[0].dataHash);
  const dataHash = run.records[0].dataHash;
  await context.request('/v1/data/hero_arena/select', { dataHash });
  assert.equal((await context.request('/v1/data/hero_arena')).dataHash, dataHash);
  display.send('game.select', { gameId: 'hero_arena', dataHash });
  display.send('match.start', { seed: 91, maxTicks: 1 });
  const started = await display.waitFor('match.started');
  assert.equal(started.payload.config.dataHash, dataHash);
  const ended = await display.waitFor('match.ended');
  validate('MatchResult', ended.payload.result);
  assert.equal(ended.payload.result.valid, true);
  assert.equal(ended.payload.result.config.dataHash, dataHash);
  const updates = display.messages.filter(message => message.type === 'playtest.progress');
  assert.ok(updates.some(message => message.payload.round === 2 && message.payload.phase === 'holdout'));
});
