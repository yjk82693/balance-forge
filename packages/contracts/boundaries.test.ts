import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, validateSchema, validateGamePayload, schema, hash, restoreSnapshot } from './index.ts';
import * as arena from '../games/action/index.ts';
test('schema names and references cannot resolve inherited object properties', () => {
  for (const name of ['toString', 'constructor', '__proto__']) {
    assert.throws(() => validate(name, {}), /INVALID_SCHEMA/);
    assert.throws(() => validateGamePayload('hero_arena', 1, name, {}), /INVALID_SCHEMA/);
    assert.throws(() => validateSchema({
      $ref: `#/$defs/${name}`
    }, {}), /INVALID_SCHEMA/);
  }
  assert.throws(() => validateSchema({
    $ref: 'other/MatchConfig'
  }, {}), /INVALID_SCHEMA/);
});
test('the schema bundle rejects unknown wire shapes and sparse arrays', () => {
  const config = JSON.parse(readFileSync(new URL('../../fixtures/match_config.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateSchema(schema, config), config);
  assert.throws(() => validateSchema(schema, {
    unknown: true
  }), /INVALID_SCHEMA/);
  assert.throws(() => validateSchema({
    type: 'array',
    items: {
      type: 'integer'
    }
  }, Array(1)), /INVALID_SCHEMA/);
});
test('snapshot payload configuration must match its outer immutable match pin', () => {
  const config = arena.makeConfig(arena.data),
    state = arena.initial(config, arena.data);
  state.payload.config.maxTicks = 100;
  assert.throws(() => restoreSnapshot({
    config,
    tick: 0,
    state,
    stateHash: hash(state)
  }, config), /VERSION_MISMATCH/);
});
