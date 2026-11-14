// Hero Cards analysis: per-card play rate and win rate when played vs available-but-not-played.
// Input assumption (see REPORT.md): statistics.players[].actions carries one entry per card with
// actionId "play:<cardId>" (opportunities = card legal in hand, uses = card played). The engine
// currently emits only "play" / "end_turn"; per-card ids need an engine change.
import { wilson95, round6 } from './wilson.ts';
import { isOutlier, useRate } from './analyzer.ts';
import { assertMatchResults } from './input-check.ts';
import { isCountable } from './group.ts';

const CARD_PREFIX = 'play:';
export const cardIdOf = (actionId) => (actionId.startsWith(CARD_PREFIX) ? actionId.slice(CARD_PREFIX.length) : null);

const side = (wins, games) => {
  const ci95 = wilson95(wins, games);
  return { wins, games, winRate: games ? round6(wins / games) : null, ci95 };
};

/**
 * @returns {{matches:number, invalidMatches:number, cards: Array}} cards sorted by cardId.
 * Each (match, player) is one sample. "Played" = uses > 0 for that card; "not played" = card had
 * opportunities but was never played. Samples with zero opportunities are excluded from both.
 * dominant / weak use the same Wilson rule as matchups: n >= 30 and the whole 95% interval above
 * 55% (dominant) or below 45% (weak), looking at the "played" group.
 */
export function analyzeCards(results) {
  assertMatchResults(results);
  const valid = results.filter(isCountable);
  const cards = new Map();
  const get = (id) => {
    if (!cards.has(id)) cards.set(id, { plays: 0, opportunities: 0, pw: 0, pg: 0, nw: 0, ng: 0 });
    return cards.get(id);
  };
  for (const r of valid) {
    for (const p of r.statistics.players) {
      const won = r.outcome.status === 'win' && r.outcome.winners.includes(p.playerId);
      for (const a of p.actions) {
        const id = cardIdOf(a.actionId);
        if (id === null) continue;
        const c = get(id);
        c.plays += a.uses;
        c.opportunities += a.opportunities;
        if (a.opportunities === 0) continue;
        if (a.uses > 0) { c.pg += 1; if (won) c.pw += 1; }
        else { c.ng += 1; if (won) c.nw += 1; }
      }
    }
  }
  const rows = [...cards.keys()].sort().map((cardId) => {
    const c = cards.get(cardId);
    const played = side(c.pw, c.pg);
    return {
      cardId,
      plays: c.plays,
      opportunities: c.opportunities,
      playRate: useRate({ uses: c.plays, opportunities: c.opportunities }),
      played,
      notPlayed: side(c.nw, c.ng),
      dominant: c.pg >= 30 && isOutlier(played.ci95, c.pg) && played.ci95[0] > 0.55,
      weak: c.pg >= 30 && isOutlier(played.ci95, c.pg) && played.ci95[1] < 0.45,
    };
  });
  return { matches: valid.length, invalidMatches: results.length - valid.length, cards: rows };
}

/**
 * Per deck and card, from the results' hero assignments: the numbers of analyzeCards for the players who ran that
 * deck, and the deck's own win rate. The flag compares the card with its DECK, not with 50%: in a deck that wins
 * 58% every card "wins when played", so a card is dominant only if the whole interval of its played group lies above
 * the whole interval of the deck's overall win rate (weak: below). Read it as "this card plays above its deck".
 */
export function analyzeCardsByDeck(results) {
  assertMatchResults(results);
  const valid = results.filter(isCountable);
  const decks = new Map();
  for (const r of valid) {
    const assigned = r.config.options?.assignments ?? {};
    for (const p of r.statistics.players) {
      const deck = assigned[p.playerId];
      if (typeof deck !== 'string') continue;
      if (!decks.has(deck)) decks.set(deck, { wins: 0, games: 0, cards: new Map() });
      const d = decks.get(deck);
      const won = r.outcome.status === 'win' && r.outcome.winners.includes(p.playerId);
      d.games += 1;
      if (won) d.wins += 1;
      for (const a of p.actions) {
        const id = cardIdOf(a.actionId);
        if (id === null) continue;
        if (!d.cards.has(id)) d.cards.set(id, { plays: 0, opportunities: 0, pw: 0, pg: 0, nw: 0, ng: 0 });
        const c = d.cards.get(id);
        c.plays += a.uses;
        c.opportunities += a.opportunities;
        if (a.opportunities === 0) continue;
        if (a.uses > 0) { c.pg += 1; if (won) c.pw += 1; } else { c.ng += 1; if (won) c.nw += 1; }
      }
    }
  }
  const rows = [];
  for (const deck of [...decks.keys()].sort()) {
    const d = decks.get(deck);
    const overall = side(d.wins, d.games);
    for (const cardId of [...d.cards.keys()].sort()) {
      const c = d.cards.get(cardId);
      if (c.opportunities === 0) continue; // a card this deck never holds
      const played = side(c.pw, c.pg);
      rows.push({ deck, cardId, plays: c.plays, opportunities: c.opportunities,
        playRate: useRate({ uses: c.plays, opportunities: c.opportunities }), played, notPlayed: side(c.nw, c.ng),
        deckWinRate: overall.winRate,
        dominant: c.pg >= 30 && played.ci95[0] > overall.ci95[1],
        weak: c.pg >= 30 && played.ci95[1] < overall.ci95[0] });
    }
  }
  return { matches: valid.length, invalidMatches: results.length - valid.length, decks: [...decks.keys()].sort()
    .map((deck) => ({ deck, ...side(decks.get(deck).wins, decks.get(deck).games) })), cards: rows };
}
