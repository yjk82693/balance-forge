import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v1 from './bot.ts';
import * as v2 from './bot-0.2.2.ts';
import * as v2b from './bot-0.2.2b.ts';
import { data, initial, makeConfig, observe, step } from './index.ts';
import { compareIds } from '../../contracts/index.ts';
// scripted-0.2.2b is a candidate variant of 0.2.2. Unit tests only.
const reach = v2.reaches();
const stateOf = (a: string, b: string, positions: { x1?: number; x2?: number } = {}) => {
  const config = makeConfig(data, 3, ['p1', 'p2'], 1800, { p1: a, p2: b });
  const state = initial(config, data);
  state.payload.entities[0].x = positions.x1 ?? 4200;
  state.payload.entities[1].x = positions.x2 ?? 9200;
  state.payload.entities[0].y = state.payload.entities[1].y = 4424;
  return state;
};
const moveOf = inputs => inputs.find(i => i.actionId === 'move')?.params;
/** A variant whose 0.2.2 stand-off for `hero` is at least `distance`, so 0.2.2 stops approaching there. */
const variantWithStandOff = (hero, distance) => {
  for (let match = 1; match < 200; match++) {
    const seed = v1.deriveBotSeed(match, 0);
    if (v2.profile(seed, hero).distance >= distance) return seed;
  }
  throw Error('no variant');
};

test('the variant has its own version, shares deriveBotSeed, and nothing production uses it', () => {
  assert.equal(v2b.botPolicyVersion, 'scripted-0.2.2b');
  assert.equal(v2b.deriveBotSeed, v1.deriveBotSeed);
  for (const file of ['../../../services/runner/match.ts', '../../../services/room/server.ts']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /bot-0\.2\.2/);
  }
  const source = readFileSync(new URL('./bot-0.2.2b.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const hero of data.characters.map(c => c.id)) assert.doesNotMatch(source, new RegExp(`['"]${hero}['"]`));
});

test('the melee stand-off keeps the seat position inside the melee band', () => {
  for (const hero of ['bari', 'real_armor', 'sepia', 'nightcrow']) {
    const [low, high] = v2.standOffRange(hero);
    for (const distance of [low, Math.round((low + high) / 2), high]) {
      const melee = v2b.meleeStandOff({ distance }, hero);
      assert.ok(melee >= 1140 && melee <= 1805, `${hero} ${distance} -> ${melee}`);
    }
    assert.equal(v2b.meleeStandOff({ distance: low }, hero), 1140);
    assert.equal(v2b.meleeStandOff({ distance: high }, hero), 1805);
  }
});

test('the same as 0.2.2 when nothing calls for melee: two projectile users far apart', () => {
  const state = stateOf('bari', 'sepia');
  for (const variant of [1, 2, 3, 99]) for (const id of ['p1', 'p2']) {
    assert.deepEqual(v2b.chooseActions(observe(state, id), 4, variant),
      v2.chooseActions(observe(state, id), 4, variant));
  }
});

test('a projectile user closes in on a melee-first opponent instead of holding back', () => {
  const state = stateOf('bari', 'daewi', { x1: 4200, x2: 9200 }); // 5,000 apart
  const variant = variantWithStandOff('bari', 5000); // 0.2.2: already inside its stand-off, stops approaching
  const view = observe(state, 'p1');
  assert.equal(moveOf(v2.chooseActions(view, 4, variant)).moveX, 0);
  assert.equal(moveOf(v2b.chooseActions(view, 4, variant)).moveX, 1000); // 0.2.2b walks toward Daewi
  // a melee-first hero itself behaves as in 0.2.2
  const daewi = observe(state, 'p2');
  assert.deepEqual(v2b.chooseActions(daewi, 4, variant), v2.chooseActions(daewi, 4, variant));
});

test('a projectile user punishes a recovering opponent when its own melee is ready, and only then', () => {
  const state = stateOf('bari', 'real_armor', { x1: 4200, x2: 9200 });
  const variant = variantWithStandOff('bari', 5000);
  const quiet = observe(state, 'p1');
  assert.equal(moveOf(v2b.chooseActions(quiet, 4, variant)).moveX, 0); // nothing to punish: holds back like 0.2.2
  state.payload.entities[1].recoveryUntil = 40; // the opponent is in recovery
  const punish = observe(state, 'p1');
  assert.equal(moveOf(v2b.chooseActions(punish, 4, variant)).moveX, 1000); // and its own melee is ready: it closes in
  assert.equal(moveOf(v2.chooseActions(punish, 4, variant)).moveX, 0);
  state.payload.entities[0].cooldowns = [999, 999, 999]; // its own melee is not ready: no punish
  assert.equal(moveOf(v2b.chooseActions(observe(state, 'p1'), 4, variant)).moveX, 0);
});

test('whole matches: never a swing out of reach, and projectile users do reach melee now', () => {
  const heroes = data.characters.map(c => c.id);
  const play = (bot, a, b, seed) => {
    const assignments = { p1: a, p2: b };
    const config = makeConfig(data, seed, ['p1', 'p2'], 500, assignments);
    config.options = { assignments };
    let state = initial(config, data);
    const out = { inRange: 0, outOfRange: 0 };
    while (state.payload.outcome.status === 'running') {
      const [e1, e2] = state.payload.entities;
      const dist = Math.hypot(e1.x - e2.x, e1.y - e2.y);
      const actions = config.players.flatMap((id, seat) => bot.chooseActions(observe(state, id), state.tick * 2,
        bot.deriveBotSeed(seed, seat))).sort((x, y) => compareIds(x.playerId, y.playerId));
      out[dist <= reach.melee ? 'inRange' : 'outOfRange'] += actions.filter(x => x.actionId === 'melee').length;
      state = step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
    }
    return out;
  };
  let inRange22 = 0, inRange22b = 0;
  for (let i = 0; i < heroes.length; i++) for (let j = i; j < heroes.length; j++) for (const seed of [1, 2, 3]) {
    const b = play(v2b, heroes[i], heroes[j], seed);
    assert.equal(b.outOfRange, 0, `${heroes[i]} vs ${heroes[j]}`);
    inRange22b += b.inRange;
    inRange22 += play(v2, heroes[i], heroes[j], seed).inRange;
  }
  assert.ok(inRange22b > inRange22, `more melee than 0.2.2 (${inRange22b} against ${inRange22})`);
});
