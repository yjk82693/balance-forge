import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../pipeline/cli.js';
import { engineRoot } from './engine.js';

const runner = (name) => join(engineRoot, 'services/runner', name);

test('recorded-roster-report.json is exactly what the CLI makes from the recorded roster run', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bf-recorded-'));
  const metrics = JSON.parse(readFileSync(runner('recorded-roster-metrics.json'), 'utf8'));
  const res = await main(['propose', '--baseline', runner('recorded-roster-match-results.json'), '--metrics',
    runner('recorded-roster-metrics.json'), '--bot-policy', metrics.botPolicyVersion, '--seed-set', metrics.seedSetId,
    '--out', out]);
  assert.equal(res.ok, true, JSON.stringify(res));
  const made = JSON.parse(readFileSync(join(out, 'report_baseline.json'), 'utf8'));
  const stored = JSON.parse(readFileSync(new URL('../recorded/recorded-roster-report.json', import.meta.url), 'utf8'));
  assert.deepEqual(stored, made);
  assert.equal(stored.recorded, true);
  assert.equal(stored.rows.length, 15);
  assert.ok(stored.rows.every((r) => r.ci95[0] < r.ci95[1] && !(r.ci95[0] === 0 && r.ci95[1] === 1)),
    'real Wilson intervals, not [0, 1]');
});
