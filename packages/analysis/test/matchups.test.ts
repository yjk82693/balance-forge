import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMatchupTable, pairBySeed } from '../src/index.ts';
import { analyzePhase } from '../pipeline/pipeline.ts';
import { main } from '../pipeline/cli.ts';
import { pairedResults } from './helpers.ts';

const ROSTER = ['bari', 'daewi', 'nightcrow', 'real_armor', 'sepia'];
const HASH = 'a'.repeat(64);

// All 15 matchups (10 distinct pairs + 5 mirrors). `a` side (alphabetically first) wins `rate` of seeds;
// in mirrors the seat-1 hero ("a" in the helper) wins `rate` of the matches.
type Rate = (x: string, y: string) => number;
function fullRoster({ seeds = 40, rate = (() => 0.5) as Rate }: any = {}) {
  const out = [];
  ROSTER.forEach((x, i) => {
    for (const y of ROSTER.slice(i)) {
      const r = rate(x, y);
      out.push(...pairedResults({ dataHash: HASH, heroes: [x, y], seeds, winner: (seed) => (seed % 10 < r * 10 ? 'a' :
        'b') }));
    }
  });
  return out.map((r, i) => ({ ...r, matchId: `m-${i + 1}` }));
}

test('table covers 5 heroes: 25 cells, 15 distinct matchups, none missing', () => {
  const t = buildMatchupTable(fullRoster());
  assert.equal(t.ok, true, JSON.stringify(t));
  const { roster, cells, matchups, missing, expected } = t.value;
  assert.deepEqual(roster, ROSTER);
  assert.equal(expected, 15);
  assert.equal(matchups.length, 15);
  assert.deepEqual(missing, []);
  assert.equal(cells.length, 5);
  assert.ok(cells.every((row) => row.length === 5 && row.every((c) => c !== null)));
  assert.equal(matchups.filter((m) => m.mirror).length, 5);
  assert.ok(matchups.some((m) => m.dimension === 'bari vs nightcrow'));
  assert.ok(matchups.some((m) => m.dimension === 'nightcrow vs nightcrow'));
});

test('cells are oriented per row hero and add up; mirror = seat-1 advantage', () => {
  const rs = fullRoster({ rate: (x, y) => (x === 'bari' && y === 'nightcrow' ? 0.8 : 0.5) });
  const { cells, matchups } = buildMatchupTable(rs).value;
  const i = (h) => ROSTER.indexOf(h);
  const bn = cells[i('bari')][i('nightcrow')];
  const nb = cells[i('nightcrow')][i('bari')];
  assert.equal(bn.dimension, nb.dimension); // one matchup, two perspectives
  assert.equal(bn.games, 80);
  assert.equal(bn.wins, 64);
  assert.equal(nb.wins, 16);
  assert.equal(bn.wins + nb.wins + bn.draws, bn.games);
  assert.equal(bn.outlier, true);
  assert.equal(nb.outlier, true);
  assert.equal(bn.winRate, 0.8);
  const mirror = cells[i('sepia')][i('sepia')];
  assert.equal(mirror.mirror, true);
  assert.equal(mirror.games, 80);
  assert.equal(mirror.outlier, false);
  assert.ok(matchups.every((m) => m.games === 80));
});

test('outlier rule unchanged: n >= 30 and interval outside 45-55%', () => {
  const small = buildMatchupTable(fullRoster({ seeds: 10, rate: () => 1 })).value; // 20 games each
  assert.ok(small.matchups.every((m) => m.tooFewGames && !m.outlier));
  const mild = buildMatchupTable(fullRoster({ seeds: 100, rate: (x, y) => (x === 'daewi' && y === 'sepia' ? 0.6 :
    0.5) })).value;
  assert.equal(mild.matchups.find((m) => m.dimension === 'daewi vs sepia').outlier, false); // 120/200, CI touches 55%
  assert.equal(mild.matchups.filter((m) => m.outlier).length, 0);
});

test('table matches the Report rows for every non-mirror matchup', () => {
  const rs = fullRoster({ rate: (x, y) => (x < y ? 0.7 : 0.5) });
  const { report, counted } = analyzePhase(rs);
  assert.equal(report.rows.length, 15);
  const { matchups } = buildMatchupTable(counted).value;
  for (const row of report.rows) {
    const m = matchups.find((x) => x.dimension === row.dimension);
    assert.ok(m, row.dimension);
    assert.deepEqual([m.wins, m.games, m.winRate, m.ci95, m.outlier], [row.wins, row.games, row.winRate, row.ci95,
      row.outlier]);
  }
});

test('missing matchups are listed, not invented; roster can include heroes with no games yet', () => {
  const rs = fullRoster().filter((r) => !JSON.stringify(r.config.options).includes('nightcrow'));
  const t = buildMatchupTable(rs, { roster: ROSTER }).value;
  assert.equal(t.matchups.length, 10);
  assert.equal(t.missing.length, 5);
  assert.ok(t.missing.includes('nightcrow vs nightcrow'));
  assert.equal(t.cells[ROSTER.indexOf('nightcrow')][ROSTER.indexOf('sepia')], null);
});

test('bad inputs become error results', () => {
  assert.equal(buildMatchupTable('x').error.code, 'INVALID_INPUT');
  assert.equal(buildMatchupTable(fullRoster(), { roster: ['bari'] }).error.code, 'INVALID_INPUT'); // unknown heroes
  assert.equal(buildMatchupTable(fullRoster(), { roster: ['bari', 'bari'] }).error.code, 'INVALID_INPUT');
  const noAsg = fullRoster().map((r) => ({ ...r, config: { ...r.config, options: undefined } }));
  assert.equal(buildMatchupTable(noAsg).error.code, 'INVALID_INPUT');
});

test('mirror matches are counted individually in pairing; invalid ones are left out', () => {
  const rs = pairedResults({ heroes: ['bari', 'bari'], seeds: 6, invalidSeeds: [2] });
  const { pairs, unpaired } = pairBySeed(rs);
  assert.equal(pairs.length, 11); // 12 matches minus the invalid one
  assert.equal(unpaired.length, 0);
});

test('CLI propose writes matchup_table.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-table-'));
  const b = join(dir, 'b.json');
  writeFileSync(b, JSON.stringify(fullRoster({ rate: (x, y) => (x === 'bari' && y === 'real_armor' ? 0.79 : 0.5) })));
  await main(['propose', '--baseline', b, '--out', dir, '--roster', ROSTER.join(',')]);
  const t = JSON.parse(readFileSync(join(dir, 'matchup_table.json'), 'utf8'));
  assert.equal(t.matchups.length, 15);
  assert.equal(JSON.parse(readFileSync(join(dir, 'report_baseline.json'), 'utf8')).rows.length, 15);
});
