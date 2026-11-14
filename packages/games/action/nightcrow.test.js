import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapter, data, makeConfig, initial } from './index.js';
import { validateData } from '../../contracts/index.js';
test('nightcrow is content only: ordinary archetypes, tiers and no guard bypass', () => {
  validateData(data);
  assert.equal(data.characters.length, 5);
  const hero = data.characters.find(c => c.id === 'nightcrow');
  assert.ok(hero);
  const moves = hero.moveIds.map(id => data.moves.find(m => m.id === id));
  assert.deepEqual(moves.map(m => m.archetype), ['melee', 'projectile', 'guard']);
  assert.deepEqual(moves.map(m => m.power), [38, 44, 0]);
  assert.ok(moves.every(m => m.weightTier <= 3));
  assert.deepEqual(data.gameRules.moveTraits.filter(t => t.ignoresGuard).map(t => t.moveId), ['spirit_arrow']);
  const config = makeConfig(data, 8, ['p1', 'p2'], 1800, {
    p1: 'nightcrow',
    p2: 'sepia'
  });
  const state = initial(config, data);
  assert.equal(state.payload.entities[0].hero, 'nightcrow');
  assert.equal(adapter.legalActions(adapter.observe(state, 'p1')).length, 4);
});
