import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson, hash, validate } from './index.ts';
const fixture = n => JSON.parse(readFileSync(new URL('../../fixtures/' + n + '.json', import.meta.url)));
test('all shared fixtures validate', () => {
  for (const [f, t] of [['match_config', 'MatchConfig'], ['observation', 'Observation'], ['patch_proposal',
    'PatchProposal'], ['report_baseline', 'Report'], ['report_patched', 'Report']]) validate(t, fixture(f));
  fixture('match_results').forEach(x => validate('MatchResult', x));
});
test('canonical keys, Unicode code points, integer rejection, SHA-256', () => {
  assert.equal(canonicalJson({
    b: 1,
    a: [2, 3]
  }), '{"a":[2,3],"b":1}');
  assert.equal(canonicalJson({
    '𐀀': 1,
    '\ue000': 2
  }), '{"":2,"𐀀":1}');
  assert.equal(hash({
    b: 1,
    a: 2
  }), hash({
    a: 2,
    b: 1
  }));
  assert.match(hash({}), /^[a-f0-9]{64}$/);
  for (const v of [undefined, NaN, Infinity, -0, 0.5, {
    x: undefined
  }, new Date()]) assert.throws(() => canonicalJson(v));
});
test('schema extends normative bundle only with approved addendum fields and transport fixture payloads validate', (
  ) => {
  const spec = readFileSync(new URL('../../spec/contract-v0.1.md', import.meta.url), 'utf8');
  const extended = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url)));
  delete extended.$defs.MatchConfig.properties.options;
  assert.deepEqual(extended.$defs.MatchResult.properties.botSeats, {
    type: 'array',
    maxItems: 4,
    uniqueItems: true,
    items: {
      type: 'string',
      minLength: 1,
      maxLength: 128
    }
  });
  delete extended.$defs.MatchResult.properties.botSeats;
  // Design intent (addendum v0.1.3, proposed): the report names the intent it used and rows carry their target.
  for (const key of ['elapsedMs', 'recorded', 'createdAt', 'humanMatches', 'intentVersion']) {
    delete extended.$defs.Report.properties[key];
  }
  for (const key of ['target', 'deltaToTarget']) delete extended.$defs.Report.properties.rows.items.properties[key];
  // Addenda v0.1.2 and v0.1.4: the patch allowlist also holds /characters/N/health, /characters/N/speed and the
  // Hero Cards paths /gameRules/cards/N/cost and /gameRules/cards/N/power (exact pattern).
  const path = extended.$defs.PatchProposal.properties.replacements.items.properties.path;
  // (indexes without leading zeros: "01" and "1" would be two paths for one move)
  assert.equal(path.pattern, '^/(tuning/damageScalePermille|moves/(0|[1-9][0-9]*)/power|' +
    'characters/(0|[1-9][0-9]*)/(health|speed)|gameRules/cards/(0|[1-9][0-9]*)/(cost|power))$');
  path.pattern = '^/(tuning/damageScalePermille|moves/[0-9]+/power)$';
  assert.deepEqual(JSON.parse(spec.match(/```json\n([\s\S]*?)```/)[1]), extended);
  for (const message of fixture('ws_messages')) {
    if (message.type === 'input.submit') validate('ActionInput', message.payload);
    if (message.type === 'state.view') validate('Observation', message.payload.observation);
    if (message.type === 'match.ended') validate('MatchResult', message.payload.result);
  }
});
test('malformed closed shapes and recursive values are rejected', () => {
  const config = fixture('match_config');
  assert.throws(() => validate('MatchConfig', {
    ...config,
    extra: 1
  }));
  assert.throws(() => validate('MatchConfig', {
    ...config,
    players: ['p1', 'p1']
  }));
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle));
});
test('optional assignments are bounded, closed and validate old fixtures unchanged', () => {
  const config = fixture('match_config');
  validate('MatchConfig', {
    ...config,
    options: {
      assignments: {
        p1: 'bari',
        p2: 'sepia'
      }
    }
  });
  for (const options of [{
    unknown: 1
  }, {
    assignments: {}
  }, {
    assignments: {
      p1: 1
    }
  }, {
    assignments: {
      p1: 'bari'
    },
    script: 'no'
  }]) assert.throws(() => validate('MatchConfig', {
    ...config,
    options
  }));
  validate('Report', {
    ...fixture('report_baseline'),
    elapsedMs: 100,
    recorded: true,
    createdAt: '2026-11-14T03:00:00Z',
    humanMatches: 2
  });
});
