import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from './index.js';
function sequence(guard = false, health = 700) {
  const config = game.makeConfig(game.data, 12, ['p1', 'p2'], 100, {
    p1: 'sepia',
    p2: 'real_armor'
  });
  let state = game.initial(config, game.data);
  state.payload.entities[0].x = 7000;
  state.payload.entities[1].x = 8200;
  state.payload.entities[1].hp = health;
  const rng = state.rng,
    events = [];
  const attack = {
    playerId: 'p1',
    seq: 0,
    tick: 1,
    turnId: 0,
    actionId: 'projectile',
    params: {
      aimX: 1000,
      aimY: 0
    }
  };
  for (let tick = 1; tick <= 20 && state.payload.outcome.status === 'running'; tick++) {
    const actions = tick === 1 ? [attack, ...(guard ? [{
      ...attack,
      playerId: 'p2',
      actionId: 'guard'
    }] : [])] : [];
    const result = game.step(state, {
      tick,
      actions,
      systemInputs: []
    }, game.data);
    events.push(...result.events);
    state = result.state;
  }
  return {
    events,
    state,
    rng
  };
}
test('hit, guard, KO and projectile lifecycle events are ordered and deterministic without cosmetic RNG', () => {
  const blocked = sequence(true),
    killed = sequence(false, 1);
  assert.deepEqual(blocked.events, sequence(true).events);
  assert.deepEqual(killed.events, sequence(false, 1).events);
  assert.ok(blocked.events.some(e => e.kind === 'combat.guard' && e.payload.phase === 'activate'));
  assert.ok(blocked.events.some(e => e.kind === 'combat.guard' && e.payload.phase === 'block'));
  assert.ok(blocked.events.some(e => e.kind === 'combat.hit' && e.payload.guarded));
  assert.ok(killed.events.some(e => e.kind === 'projectile.spawn'));
  assert.ok(killed.events.some(e => e.kind === 'projectile.expire' && e.payload.reason === 'hit'));
  assert.equal(killed.events.filter(e => e.kind === 'combat.ko').length, 1);
  assert.equal(new Set(killed.events.map(e => e.eventId)).size, killed.events.length);
  assert.equal(killed.state.rng, killed.rng);
});
test('projectile expiry covers lifetime and leaving the arena', () => {
  for (const [life, reason] of [[1, 'lifetime'], [45, 'bounds']]) {
    const data = structuredClone(game.data);
    data.gameRules.projectileLife = life;
    let state = game.initial(game.makeConfig(data), data);
    const all = [];
    for (let tick = 1; tick < 40; tick++) {
      const actions = tick === 1 ? [{
        playerId: 'p1',
        seq: 0,
        tick,
        turnId: 0,
        actionId: 'projectile',
        params: {
          aimX: 0,
          aimY: -1000
        }
      }] : [];
      const r = game.step(state, {
        tick,
        actions,
        systemInputs: []
      }, data);
      state = r.state;
      all.push(...r.events);
    }
    assert.ok(all.some(e => e.kind === 'projectile.expire' && e.payload.reason === reason));
  }
});
