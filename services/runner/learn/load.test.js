import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PARAMS, policyVersion } from '../../../packages/games/action/bot-learned.js';
import { learnedBot, readLearned } from './load.js';
import { evalMatchup } from '../eval-bots.js';
import { pairedJobs, rosterJobs, runMatch } from '../match.js';

const file = (hero, over = {}) => JSON.stringify({ policy: 'learned-cem-1', hero,
  params: { ...DEFAULT_PARAMS, ...over } });
const withDir = (files, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'learned-load-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('readLearned loads valid files, and reports (never half-trusts) the others', () => {
  withDir({ 'bari.json': file('bari', { aggression: 50 }), 'daewi.json': file('daewi'),
    'sepia.json': file('sepia', { standOff: 99999 }), // out of range
    'nightcrow.json': JSON.stringify({ policy: 'something-else', hero: 'nightcrow', params: DEFAULT_PARAMS }),
    'real_armor.json': file('bari'), // the hero does not match the file name
    'broken.json': '{not json', 'notes.txt': 'ignored' }, dir => {
    const { paramsByHero, skipped } = readLearned(dir);
    assert.deepEqual(Object.keys(paramsByHero).sort(), ['bari', 'daewi']);
    assert.equal(paramsByHero.bari.aggression, 50);
    assert.deepEqual(skipped.map(s => s.file).sort(),
      ['broken.json', 'nightcrow.json', 'real_armor.json', 'sepia.json']);
    const bot = learnedBot(dir);
    assert.equal(bot.botPolicyVersion, policyVersion(paramsByHero));
  });
  assert.deepEqual(readLearned('/no/such/dir'), { paramsByHero: {}, files: {}, skipped: [] });
  assert.equal(learnedBot('/no/such/dir'), null);
});

test('jobs with botPolicy: scripted is the default, learned needs trained files, anything else is refused', () => {
  const plain = pairedJobs({ seeds: [1] });
  assert.ok(plain.every(job => !('botPolicy' in job))); // unchanged jobs for the default policy
  assert.ok(pairedJobs({ seeds: [1], botPolicy: 'scripted' }).every(job => job.botPolicy === 'scripted'));
  for (const bad of ['trained', '', 7, null]) {
    assert.throws(() => pairedJobs({ seeds: [1], botPolicy: bad }), /INVALID_SCHEMA/);
  }
  assert.throws(() => pairedJobs({ seeds: [1], gameId: 'hero_cards', botPolicy: 'learned' }), /INVALID_SCHEMA/);
  assert.throws(() => rosterJobs({ seeds: [1], botPolicy: 'x' }), /INVALID_SCHEMA/);
});

test('a scripted job gives the same result as before; the default result never depends on learned files', () => {
  const [job] = pairedJobs({ seeds: [3] });
  const [scripted] = pairedJobs({ seeds: [3], botPolicy: 'scripted' });
  assert.deepEqual(runMatch(scripted).finalStateHash, runMatch(job).finalStateHash);
  assert.equal(runMatch(job).valid, true);
});

test('evalMatchup: four pairings with intervals when learned files exist, only the scripted row without them', () => {
  withDir({ 'bari.json': file('bari', { aggression: 100 }), 'daewi.json': file('daewi', { standOff: 1200 }) }, dir => {
    const out = evalMatchup({ heroes: ['daewi', 'bari'], pairs: 2, dir, maxTicks: 150 });
    assert.equal(out.matchup, 'bari vs daewi');
    assert.equal(out.first, 'bari');
    assert.deepEqual(out.learnedHeroes, ['bari', 'daewi']);
    assert.match(out.learnedVersion, /^learned-cem-1\+[0-9a-f]{8}$/);
    assert.equal(out.scriptedVersion, 'scripted-0.2.1');
    assert.deepEqual(Object.keys(out.rows), ['scriptedVsScripted', 'learnedVsLearned', 'learnedFirstVsScripted',
      'scriptedFirstVsLearned']);
    for (const row of Object.values(out.rows)) {
      assert.equal(row.games, 4);
      assert.ok(row.ci95[0] <= row.winRate && row.winRate <= row.ci95[1]);
    }
  });
  const none = evalMatchup({ heroes: ['bari', 'sepia'], pairs: 1, dir: '/no/such/dir', maxTicks: 150 });
  assert.deepEqual(Object.keys(none.rows), ['scriptedVsScripted']);
  assert.equal(none.learnedVersion, null);
  for (const bad of [{ heroes: ['bari'] }, { heroes: ['bari', 'nobody'] }, { heroes: ['bari', 'sepia'], pairs: 0 },
    { heroes: ['bari', 'sepia'], pairs: 2000 }]) assert.throws(() => evalMatchup(bad), /INVALID_SCHEMA/);
});
