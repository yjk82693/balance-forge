import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xorshift32 } from './index.js';
import * as game from '../games/action/index.js';
import { chooseActions, deriveBotSeed } from '../games/action/bot.js';
import { hash, validateGamePayload } from '../contracts/index.js';
test('xorshift32-v1 reference sequence and zero rejection', () => {
  let x = 1;
  const actual = [];
  for (let i = 0; i < 5; i++) {
    x = xorshift32(x);
    actual.push(x);
  }
  assert.deepEqual(actual, [270369, 67634689, 2647435461, 307599695, 2398689233]);
  assert.throws(() => xorshift32(0));
});
test('100 seeds × 1,000 active ticks × two runs: every tick hash matches', () => {
  // Large legal health values keep combat active for the full 1,000-tick test.
  for (let seed = 1; seed <= 100; seed++) {
    const data = structuredClone(game.data);
    for (const c of data.characters) c.health = 1000000;
    const heroes = data.characters.map(c => c.id);
    const assignments = {
      p1: heroes[seed % heroes.length],
      p2: heroes[(seed + 1) % heroes.length]
    };
    const config = game.makeConfig(data, seed, ['p1', 'p2'], 1800, assignments),
      first = [],
      frames = [];
    let state = game.initial(config, data);
    for (let i = 0; i < 1000; i++) {
      const actions = config.players.flatMap((id, j) => chooseActions(game.observe(state, id), i * 2,
        deriveBotSeed(config.seed, j)));
      const frame = {
        tick: state.tick + 1,
        actions,
        systemInputs: []
      };
      frames.push(frame);
      state = game.step(state, frame, data).state;
      first.push(hash(state));
    }
    validateGamePayload('hero_arena', 1, 'state', state.payload);
    let second = game.initial(config, data);
    for (let i = 0; i < 1000; i++) {
      const actions = config.players.flatMap((id, j) => chooseActions(game.observe(second, id), i * 2,
        deriveBotSeed(config.seed, j)));
      const secondFrame = {
        tick: second.tick + 1,
        actions,
        systemInputs: []
      };
      assert.deepEqual(secondFrame, frames[i]);
      second = game.step(second, secondFrame, data).state;
      assert.equal(hash(second), first[i], `seed ${seed}, tick ${i + 1}`);
    }
    assert.equal(second.tick, 1000);
  }
});
