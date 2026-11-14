import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as arena from '../../../packages/games/action/index.ts';
import { compareIds, hash } from '../../../packages/contracts/index.ts';
import * as scripted from '../../../packages/games/action/bot.ts';
import { makeClonedBot, CLASSES, FEATURE_NAMES } from '../../../packages/games/action/bot-cloned.ts';
import { loadMatches, trainHumanStyle } from './train-human.ts';

// Synthetic "human" matches: scripted-bot play recorded the way the room records a match (config, frames, result).
function recorded(seed, heroes, bot) {
  const config = arena.makeConfig(arena.data, seed, ['p1', 'p2'], 240, heroes);
  config.options = { assignments: heroes };
  let state = arena.initial(config, arena.data);
  const frames = [];
  while (arena.outcome(state).status === 'running') {
    const actions = config.players.flatMap((id, seat) => scripted.chooseActions(arena.observe(state, id),
      state.tick * 2, scripted.deriveBotSeed(seed, seat))).sort((a, b) => compareIds(a.playerId, b.playerId));
    const frame = { tick: state.tick + 1, actions, systemInputs: [] };
    frames.push(frame);
    state = arena.step(state, frame, arena.data).state;
  }
  const matchId = `human-${seed}`;
  const result = { matchId, config, outcome: arena.outcome(state), statistics: arena.statistics(state),
    finalStateHash: arena.hash(state), valid: true, errorCode: '', ...(bot ? { botSeats: [bot] } : {}) };
  return { result, recording: { matchId, seed, config, frames, finalStateHash: result.finalStateHash } };
}

function fixtureDir(count) {
  const dir = mkdtempSync(join(tmpdir(), 'human-style-'));
  const results = [];
  for (let seed = 1; seed <= count; seed++) {
    const { result, recording } = recorded(seed, seed % 2 ? { p1: 'bari', p2: 'real_armor' } :
      { p1: 'real_armor', p2: 'bari' }, 'p2');
    writeFileSync(join(dir, `${result.matchId}.json`), JSON.stringify(recording));
    results.push(result);
  }
  return { dir, results };
}

test('the split is by match, the file carries its honesty fields, and a mismatching recording is excluded', () => {
  const { dir, results } = fixtureDir(8);
  try {
    // a result whose recorded final state does not match its recording: excluded with a reason, never used
    const broken = { ...results[0], matchId: 'human-broken', finalStateHash: 'f'.repeat(64) };
    writeFileSync(join(dir, 'human-broken.json'), JSON.stringify({ matchId: 'human-broken', seed: 1,
      config: results[0].config, frames: [], finalStateHash: broken.finalStateHash }));
    const model = trainHumanStyle({ results: [...results, broken], replaysDir: dir, steps: 40,
      createdAt: '2026-11-14T00:00:00.000Z' });
    assert.equal(model.policy, 'cloned-lr-1');
    assert.deepEqual(model.features, FEATURE_NAMES);
    assert.equal(model.weights.length, CLASSES.length);
    assert.equal(model.trainedOn.matchesUsed, 8);
    assert.deepEqual(model.trainedOn.excluded.map(e => e.matchId), ['human-broken']);
    assert.equal(model.trainedOn.split, 'by match');
    assert.equal(model.trainedOn.matchesTrain + model.trainedOn.matchesTest, 8);
    assert.equal(model.trainedOn.humanSeats, 8); // one human seat per match: the bot seat is never trained on
    assert.equal(model.readiness.ready, false); // 8 < 10 matches
    assert.ok(model.caveats.length >= 3);
    for (const key of ['accuracy', 'baselineAccuracy', 'baselineClass', 'matches']) {
      assert.ok(key in model.accuracy.heldOut, key);
    }
    assert.ok(model.accuracy.crossValidation.folds >= 2);
    // deterministic: the same data and seed give the same file
    assert.deepEqual(trainHumanStyle({ results: [...results, broken], replaysDir: dir, steps: 40,
      createdAt: '2026-11-14T00:00:00.000Z' }), model);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('other games, unfinished and unrecorded matches are left out', () => {
  const { dir, results } = fixtureDir(2);
  try {
    const cards = { ...results[0], matchId: 'c', config: { ...results[0].config, gameId: 'hero_cards' } };
    const running = { ...results[0], matchId: 'r', valid: false };
    const missing = { ...results[0], matchId: 'm' };
    const { used, excluded } = loadMatches({ results: [...results, cards, running, missing], replaysDir: dir });
    assert.equal(used.length, 2);
    assert.deepEqual(excluded.map(e => [e.matchId, e.reason]).sort(), [['m', 'no recording'],
      ['r', 'not a finished valid match']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the cloned bot is deterministic per seed and tick, differs between seeds, and plays only legal inputs', () => {
  const { dir, results } = fixtureDir(8);
  try {
    const model = trainHumanStyle({ results, replaysDir: dir, steps: 40, createdAt: 'x' });
    const bot = makeClonedBot(model);
    const config = arena.makeConfig(arena.data, 3, ['p1', 'p2'], 120, { p1: 'bari', p2: 'real_armor' });
    config.options = { assignments: { p1: 'bari', p2: 'real_armor' } };
    const play = seed => {
      let state = arena.initial(config, arena.data);
      const log = [];
      while (arena.outcome(state).status === 'running') {
        const actions = ['p1', 'p2'].flatMap((id, i) => bot.chooseActions(arena.observe(state, id), state.tick * 2,
          bot.deriveBotSeed(seed, i))).sort((a, b) => compareIds(a.playerId, b.playerId));
        log.push(actions);
        state = arena.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, arena.data).state; // legal
      }
      return log;
    };
    assert.deepEqual(play(5), play(5));
    assert.notDeepEqual(play(5), play(6));
    assert.equal(hash(play(5)), hash(play(5)));
    const argmax = makeClonedBot(model, { mode: 'argmax' });
    const view = arena.observe(arena.initial(config, arena.data), 'p1');
    assert.deepEqual(argmax.chooseActions(view, 0, 1), argmax.chooseActions(view, 0, 99)); // no roll in argmax
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
