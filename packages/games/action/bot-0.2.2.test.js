import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as old from './bot.js';
import * as next from './bot-0.2.2.js';
import { data, initial, makeConfig, observe, step, legalActions } from './index.js';
import { compareIds } from '../../contracts/index.js';
// scripted-0.2.2 is a candidate. These are unit tests only: no recorded data, no workers, no wall clock.
const heroes = data.characters.map(c => c.id);
const reach = next.reaches();

test('the candidate has its own version, reuses deriveBotSeed, and nothing production uses it yet', () => {
  assert.equal(next.botPolicyVersion, 'scripted-0.2.2');
  assert.equal(old.botPolicyVersion, 'scripted-0.2.1');
  assert.equal(next.deriveBotSeed, old.deriveBotSeed);
  const runner = readFileSync(new URL('../../../services/runner/match.js', import.meta.url), 'utf8');
  assert.match(runner, /action\/bot\.js'/);
  assert.doesNotMatch(runner, /bot-0\.2\.2/);
  const room = readFileSync(new URL('../../../services/room/server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(room, /bot-0\.2\.2/);
});

test('reach and stand-off come from the data: melee-first heroes close in, projectile users stay back', () => {
  assert.deepEqual(reach, { melee: 1900, projectile: 16000 }); // 460 x 45 is 20700, capped by the arena width
  assert.equal(next.strongestAttack('daewi'), 'melee'); // heavy_melee 62 beats projectile 44
  for (const hero of ['bari', 'real_armor', 'sepia', 'nightcrow']) {
    assert.equal(next.strongestAttack(hero), 'projectile');
  }
  assert.deepEqual(next.standOffRange('daewi'), [1140, 1805]); // 60-95% of 1900
  assert.deepEqual(next.standOffRange('bari'), [3200, 6400]); // 20-40% of 16000
  for (const hero of heroes) {
    const [low, high] = next.standOffRange(hero);
    if (next.strongestAttack(hero) === 'melee') assert.ok(high < reach.melee, `${hero} stays inside its melee range`);
    else assert.ok(high <= reach.projectile, `${hero} stays inside its projectile range`);
  }
});

test('no hero branches: the same rule follows the data when the moves change', () => {
  const changed = structuredClone(data);
  const bari = changed.characters.find(c => c.id === 'bari');
  changed.moves.find(m => m.id === 'spirit_arrow').power = 10; // melee (38) is now Bari's strongest attack
  assert.equal(next.strongestAttack('bari', changed), 'melee');
  assert.deepEqual(next.standOffRange('bari', changed), [1140, 1805]);
  changed.moves.find(m => m.id === 'melee').power = 10; // 10 against 10: a tie goes to melee
  assert.equal(next.strongestAttack('bari', changed), 'melee');
  changed.moves.find(m => m.id === 'melee').power = 5; // now the projectile is stronger again
  assert.equal(next.strongestAttack('bari', changed), 'projectile');
  assert.equal(next.strongestAttack('nobody', data), 'melee'); // a missing hero falls back to melee
  assert.ok(bari);
  const source = readFileSync(new URL('./bot-0.2.2.js', import.meta.url), 'utf8');
  for (const hero of heroes) assert.doesNotMatch(source.replace(/\/\/.*$/gm, ''), new RegExp(`['"]${hero}['"]`));
});

test('the seeded stand-off always falls inside the hero range, and the other draws are those of 0.2.1', () => {
  for (const hero of heroes) {
    const [low, high] = next.standOffRange(hero);
    const seen = new Set();
    for (let match = 1; match <= 60; match++) for (let seat = 0; seat < 2; seat++) {
      const seed = old.deriveBotSeed(match, seat);
      const profile = next.profile(seed, hero);
      assert.ok(profile.distance >= low && profile.distance <= high, `${hero} ${profile.distance}`);
      assert.ok(profile.reaction >= 0 && profile.reaction <= 12);
      assert.ok(profile.guardChance >= 55 && profile.guardChance <= 95);
      assert.deepEqual(next.profile(seed, hero), profile); // deterministic
      seen.add(profile.distance);
    }
    assert.ok(seen.size > 20, `${hero} draws vary`);
  }
  // reaction, guard chance, strafe and aim come from the same stream positions as in 0.2.1
  const seed = old.deriveBotSeed(7, 1);
  const a = next.profile(seed, 'daewi');
  const b = next.profile(seed, 'bari');
  for (const key of ['reaction', 'guardChance', 'strafe', 'aimX', 'aimY']) assert.equal(a[key], b[key]);
});

test('at the start of a match, far apart, the decisions are exactly those of 0.2.1', () => {
  for (const a of heroes) for (const b of heroes) {
    const config = makeConfig(data, 3, ['p1', 'p2'], 1800, { p1: a, p2: b });
    const state = initial(config, data);
    for (const variant of [1, 2, 3, 99, 123456]) for (const id of ['p1', 'p2']) {
      assert.deepEqual(next.chooseActions(observe(state, id), 4, variant),
        old.chooseActions(observe(state, id), 4, variant));
    }
  }
});

test('a melee swing is never started out of reach, in whole matches of every hero pair', () => {
  let swings = 0;
  for (let i = 0; i < heroes.length; i++) for (let j = i; j < heroes.length; j++) for (const seed of [1, 2]) {
    const assignments = { p1: heroes[i], p2: heroes[j] };
    const config = makeConfig(data, seed, ['p1', 'p2'], 600, assignments);
    config.options = { assignments };
    let state = initial(config, data);
    while (state.payload.outcome.status === 'running') {
      const [e1, e2] = state.payload.entities;
      const dist = Math.hypot(e1.x - e2.x, e1.y - e2.y);
      const actions = config.players.flatMap((id, seat) => next.chooseActions(observe(state, id), state.tick * 2,
        next.deriveBotSeed(seed, seat))).sort((x, y) => compareIds(x.playerId, y.playerId));
      for (const action of actions.filter(x => x.actionId === 'melee')) {
        swings += 1;
        assert.ok(dist <= reach.melee,
          `${action.playerId} swung at ${Math.round(dist)} in ${heroes[i]} vs ${heroes[j]}`);
      }
      state = step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
    }
  }
  assert.ok(swings > 100, `melee still happens (${swings} swings)`);
});

test('melee heroes now reach melee: more in-range swings than 0.2.1, and none out of range', () => {
  const play = bot => {
    const count = { inRange: 0, outOfRange: 0 };
    for (const seed of [1, 2, 3, 4]) {
      const assignments = { p1: 'daewi', p2: 'real_armor' };
      const config = makeConfig(data, seed, ['p1', 'p2'], 400, assignments);
      config.options = { assignments };
      let state = initial(config, data);
      while (state.payload.outcome.status === 'running') {
        const [e1, e2] = state.payload.entities;
        const dist = Math.hypot(e1.x - e2.x, e1.y - e2.y);
        const actions = config.players.flatMap((id, seat) => bot.chooseActions(observe(state, id), state.tick * 2,
          bot.deriveBotSeed(seed, seat))).sort((x, y) => compareIds(x.playerId, y.playerId));
        count[dist <= reach.melee ? 'inRange' : 'outOfRange'] += actions.filter(x => x.actionId === 'melee').length;
        state = step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
      }
    }
    return count;
  };
  const before = play(old), after = play(next);
  assert.ok(before.outOfRange > 0, 'the old policy swings at nothing');
  assert.equal(after.outOfRange, 0);
  assert.ok(after.inRange > 0);
});

test('same input, same output; inputs keep the 0.2.1 shape', () => {
  const state = initial(makeConfig(data, 5), data);
  const view = observe(state, 'p1');
  const first = next.chooseActions(view, 10, 42);
  assert.deepEqual(next.chooseActions(view, 10, 42), first);
  for (const input of first) {
    assert.deepEqual(Object.keys(input).sort(), ['actionId', 'params', 'playerId', 'seq', 'tick', 'turnId']);
    assert.equal(input.tick, view.tick + 1);
  }
  assert.ok(legalActions(view).length > 0);
  assert.deepEqual(next.chooseActions(observe(state, 'display'), 0, 0), []);
});
