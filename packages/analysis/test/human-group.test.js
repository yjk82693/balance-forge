import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHumanGroup, heroDisplayName, smallSampleNote, addHumanRows, analyze } from '../src/index.js';
import { main } from '../pipeline/cli.js';
import { pairedResults } from './helpers.js';

// Humans: bari beats real_armor 4-1 in 5 matches (one seat-swapped pair is enough variety).
const humanFive = () => {
  const rs = pairedResults({ seeds: 3, heroes: ['bari', 'real_armor'], winner: (seed, swap) => (seed === 3 && swap === 1 ? 'b' : 'a') }); // 6 matches
  return rs.slice(0, 5);
};

test('label reads "Humans: Bari vs Real Armor 4–1 (n=5)" with an honest note and no outlier', () => {
  const out = buildHumanGroup(humanFive());
  assert.equal(out.ok, true, JSON.stringify(out));
  const [g] = out.value.groups;
  assert.match(g.label, /^Humans: Bari vs Real Armor \d–\d \(n=5\)$/);
  assert.equal(g.winsA + g.winsB + g.draws, 5);
  assert.equal(g.n, 5);
  assert.equal(g.smallSample, true);
  assert.equal(g.outlier, false);
  assert.match(g.note, /Only 5 games/);
  assert.match(g.note, /30/);
  assert.equal(out.value.humanMatches, 5);
});

test('exact 4–1 example', () => {
  const rs = pairedResults({ seeds: 3, heroes: ['bari', 'real_armor'], winner: () => 'a' }).slice(0, 5);
  rs[4].outcome = { status: 'win', winners: [rs[4].config.players[rs[4].config.players.findIndex((p) => rs[4].config.options.assignments[p] === 'real_armor')]], reason: 'hp_zero' };
  const { groups } = buildHumanGroup(rs).value;
  assert.equal(groups[0].label, 'Humans: Bari vs Real Armor 4–1 (n=5)');
});

test('even an extreme tiny sample never gets the outlier flag; 30+ does', () => {
  const tiny = buildHumanGroup(pairedResults({ seeds: 10, winner: () => 'a' })).value.groups[0]; // 20-0
  assert.equal(tiny.outlier, false);
  assert.equal(tiny.winsA, 20);
  const big = buildHumanGroup(pairedResults({ seeds: 20, winner: () => 'a' })).value.groups[0]; // 40-0
  assert.equal(big.smallSample, false);
  assert.equal(big.outlier, true);
  assert.match(big.note, /^95% CI \d+–\d+% · n = 40$/);
});

test('draws are shown, invalid matches are counted apart, hero names are readable', () => {
  const rs = pairedResults({ seeds: 3, winner: (seed) => (seed === 1 ? 'draw' : 'a') });
  rs[5].valid = false;
  const { groups, invalidMatches, humanMatches } = buildHumanGroup(rs).value;
  assert.equal(invalidMatches, 1);
  assert.equal(humanMatches, 5);
  assert.match(groups[0].label, /, 2 draws \(n=5\)$/);
  assert.equal(heroDisplayName('real_armor'), 'Real Armor');
  assert.equal(heroDisplayName('p1'), 'P1');
  assert.match(smallSampleNote(1), /Only 1 game\./);
});

test('no human matches -> empty group list; bad input -> error result', () => {
  assert.deepEqual(buildHumanGroup([]).value, { humanMatches: 0, invalidMatches: 0, groups: [] });
  assert.equal(buildHumanGroup({}).error.code, 'INVALID_INPUT');
  assert.equal(buildHumanGroup([{ valid: true }]).error.code, 'INVALID_INPUT');
});

test('Report human rows agree with the group summary', () => {
  const human = humanFive();
  const bot = analyze(pairedResults({ seeds: 100 }));
  const rep = addHumanRows(bot, human);
  const g = buildHumanGroup(human).value.groups[0];
  const row = rep.rows.find((r) => r.dimension === g.dimension);
  assert.deepEqual([row.wins, row.games, row.ci95, row.outlier], [g.winsA, g.n, g.ci95, g.outlier]);
});

test('CLI writes human_group.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bf-hg-'));
  const w = (n, v) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(v)); return p; };
  await main(['propose', '--baseline', w('b.json', pairedResults({ seeds: 100 })), '--human', w('h.json', humanFive()), '--out', dir]);
  const g = JSON.parse(readFileSync(join(dir, 'human_group.json'), 'utf8'));
  assert.equal(g.groups[0].n, 5);
  assert.equal(g.groups[0].outlier, false);
});
