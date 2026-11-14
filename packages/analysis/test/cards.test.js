import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCards, cardIdOf } from '../src/index.js';
import { fixture } from './helpers.js';

// p1 plays "spark" every match and wins when it does; "ward" is available but never played.
function cardMatch(i, { p1Wins = true, spark = 1, ward = 0, sparkOpp = 3 } = {}) {
  const base = fixture('match_results.json')[0];
  const actions = (s, w, so) => [
    { actionId: 'play:spark', opportunities: so, uses: s },
    { actionId: 'play:ward', opportunities: 2, uses: w },
    { actionId: 'end_turn', opportunities: 6, uses: 6 },
  ];
  const r = structuredClone(base);
  r.matchId = `c-${i}`;
  r.config.gameId = 'hero_cards';
  r.outcome = { status: 'win', winners: [p1Wins ? 'p1' : 'p2'], reason: 'hp_zero' };
  r.statistics.players[0].actions = actions(spark, ward, sparkOpp);
  r.statistics.players[1].actions = actions(0, 0, sparkOpp);
  return r;
}

test('cardIdOf only reads play:<card> actions', () => {
  assert.equal(cardIdOf('play:spark'), 'spark');
  assert.equal(cardIdOf('end_turn'), null);
  assert.equal(cardIdOf('play'), null);
});

test('play rate, played vs not-played win rates, dominant flag', () => {
  const rs = Array.from({ length: 40 }, (_, i) => cardMatch(i));
  const { cards, matches } = analyzeCards(rs);
  assert.equal(matches, 40);
  const spark = cards.find((c) => c.cardId === 'spark');
  assert.equal(spark.plays, 40);
  assert.equal(spark.opportunities, 240); // 3 opportunities x 2 players x 40 matches
  assert.ok(Math.abs(spark.playRate - 1 / 6) < 1e-9);
  assert.deepEqual([spark.played.wins, spark.played.games], [40, 40]); // p1 played and won
  assert.deepEqual([spark.notPlayed.wins, spark.notPlayed.games], [0, 40]); // p2 had it, never played, lost
  assert.equal(spark.dominant, true);
  assert.equal(spark.weak, false);
  const ward = cards.find((c) => c.cardId === 'ward');
  assert.equal(ward.plays, 0);
  assert.equal(ward.played.games, 0);
  assert.equal(ward.played.winRate, null);
  assert.equal(ward.dominant, false);
});

test('small samples never flag; weak side works; invalid skipped; zero opportunities -> null rate', () => {
  const few = analyzeCards(Array.from({ length: 10 }, (_, i) => cardMatch(i)));
  assert.equal(few.cards[0].dominant, false); // n < 30
  const losing = analyzeCards(Array.from({ length: 40 }, (_, i) => cardMatch(i, { p1Wins: false })));
  assert.equal(losing.cards.find((c) => c.cardId === 'spark').weak, true);
  const inv = cardMatch(0); inv.valid = false;
  assert.equal(analyzeCards([inv]).invalidMatches, 1);
  assert.equal(analyzeCards([cardMatch(1, { spark: 0,
    sparkOpp: 0 })]).cards.find((c) => c.cardId === 'spark').playRate, null);
});

test('50/50 card is not dominant even with many samples', () => {
  const rs = Array.from({ length: 100 }, (_, i) => cardMatch(i, { p1Wins: i % 2 === 0 }));
  assert.equal(analyzeCards(rs).cards.find((c) => c.cardId === 'spark').dominant, false);
});
