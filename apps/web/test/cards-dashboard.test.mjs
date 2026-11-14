import { test } from "node:test";
import assert from "node:assert/strict";
import { cardDiagnosisFrom } from "../src/lib/cardDiagnosis.ts";
import { cardChangeLabel } from "../src/lib/cards.ts";
import { scenesFor } from "../src/lib/presenter.ts";

const side = { wins: 10, games: 20, winRate: 0.5, ci95: [0.3, 0.7] };
const body = {
  kind: "cards",
  matchup: "nightcrow vs standard",
  focalDeck: "nightcrow",
  focalRate: 0.75,
  target: 0.5,
  direction: "down",
  probeBaseline: { rate: 0.74, games: 200, ci95: [0.68, 0.8] },
  levers: [
    { path: "/gameRules/cards/5/cost", cardId: "mechanical_crows", field: "cost", from: 2, to: 3, rate: 0.6,
      games: 200, effect: -0.14, significant: true, towardTarget: true },
    { path: "/gameRules/cards/5/oops", cardId: "x", field: "speed", from: 1, to: 2, effect: 0.1 },
  ],
  probed: 14,
  significantLevers: 5,
  cards: {
    matches: 200,
    decks: [{ deck: "nightcrow", wins: 150, games: 200, winRate: 0.75 }],
    cards: [
      { deck: "nightcrow", cardId: "pulse", plays: 5, opportunities: 10, playRate: 0.5, played: side, notPlayed: side,
        deckWinRate: 0.75, dominant: true, weak: false },
      { deck: "nightcrow", cardId: "broken" },
    ],
  },
};

test("a cards diagnosis is read: levers, card rows and decks; bad entries are dropped", () => {
  const d = cardDiagnosisFrom(body);
  assert.ok(d);
  assert.equal(d.levers.length, 1);
  assert.equal(d.levers[0].significant, true);
  assert.equal(d.cards.length, 1);
  assert.equal(d.cards[0].dominant, true);
  assert.equal(d.decks[0].deck, "nightcrow");
  assert.equal(d.probed, 14);
});

test("an arena diagnosis (no kind cards) or nothing usable gives null", () => {
  assert.equal(cardDiagnosisFrom({ heroes: [] }), null);
  assert.equal(cardDiagnosisFrom({ ...body, kind: "heroes" }), null);
  assert.equal(cardDiagnosisFrom({ kind: "cards", matchup: "a vs b", levers: [], cards: null }), null);
  assert.equal(cardDiagnosisFrom(null), null);
});

test("a card change label puts the field in lower case, other paths stay as they are", () => {
  assert.equal(cardChangeLabel("/gameRules/cards/4/cost", "Pulse · Cost"), "Pulse · cost");
  assert.equal(cardChangeLabel("/characters/1/health", "Daewi · Health"), "Daewi · Health");
  assert.equal(cardChangeLabel("/gameRules/cards/4/cost", undefined), undefined);
});

test("the cards scene exists only when a Hero Cards result does", () => {
  const ids = (cards) => scenesFor({ intent: false, profile: false, history: true, cards }).map((s) => s.id);
  assert.ok(!ids(false).includes("cards"));
  const withCards = ids(true);
  assert.ok(withCards.indexOf("cards") > withCards.indexOf("verdict"));
  assert.ok(withCards.indexOf("cards") < withCards.indexOf("history"));
});
