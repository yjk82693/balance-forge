import type { CardDiagnosis, CardRow, CardSide, PlaytestRun } from "./api";
import type { Report, ReportRow } from "./contract";
import { wilson } from "./stats";

/**
 * Sample data for ?mock=1 with the Hero Cards game only: one deck matchup, a card table and card levers with
 * hand-picked numbers. Never shown as results; the screen labels it "sample data".
 */
const MATCHUP = "nightcrow vs standard";
const row = (wins: number, games: number): ReportRow => ({
  dimension: MATCHUP,
  wins,
  games,
  winRate: wins / games,
  ci95: wilson(wins, games),
  uses: 0,
  opportunities: 0,
  outlier: games >= 30 && wilson(wins, games)[0] > 0.55,
  target: 0.5,
});

export function mockCardsReport(version: "broken" | "patched"): Report {
  const [wins, games] = version === "patched" ? [104, 200] : [141, 200];
  return {
    reportId: `sample-cards-${version}`,
    gameId: "hero_cards",
    simVersion: "sample",
    dataHash: "",
    botPolicyVersion: "sample",
    seedSetId: "sample",
    validMatches: games,
    invalidMatches: 0,
    draws: 0,
    rows: [row(wins, games)],
  };
}

const side = (wins: number, games: number): CardSide => ({
  wins,
  games,
  winRate: wins / games,
  ci95: wilson(wins, games),
});

function card(deck: string, cardId: string, p: [number, number], n: [number, number], plays: number, opp: number,
  deckRate: number, flag?: "dominant" | "weak"): CardRow {
  return {
    deck,
    cardId,
    plays,
    opportunities: opp,
    playRate: plays / opp,
    played: side(...p),
    notPlayed: side(...n),
    deckWinRate: deckRate,
    dominant: flag === "dominant",
    weak: flag === "weak",
  };
}

export function mockCardsRun(): PlaytestRun {
  const diagnosis: CardDiagnosis = {
    matchup: MATCHUP,
    focalDeck: "nightcrow",
    focalRate: 141 / 200,
    target: 0.5,
    direction: "down",
    probeBaseline: { rate: 0.7, games: 200, ci95: wilson(140, 200) },
    levers: [
      { path: "/gameRules/cards/5/cost", cardId: "mechanical_crows", field: "cost", from: 2, to: 3, rate: 0.55,
        games: 200, effect: -0.15, significant: true, towardTarget: true },
      { path: "/gameRules/cards/5/power", cardId: "mechanical_crows", field: "power", from: 2, to: 1, rate: 0.6,
        games: 200, effect: -0.1, significant: true, towardTarget: true },
      { path: "/gameRules/cards/3/cost", cardId: "hypnosis", field: "cost", from: 2, to: 3, rate: 0.66, games: 200,
        effect: -0.04, significant: false, towardTarget: true },
    ],
    probed: 12,
    significantLevers: 4,
    decks: [
      { deck: "nightcrow", wins: 141, games: 200, winRate: 0.705 },
      { deck: "standard", wins: 59, games: 200, winRate: 0.295 },
    ],
    cards: [
      card("nightcrow", "mechanical_crows", [118, 150], [23, 50], 180, 200, 0.705, "dominant"),
      card("nightcrow", "hypnosis", [120, 170], [21, 30], 190, 200, 0.705),
      card("nightcrow", "spark", [130, 190], [8, 10], 195, 200, 0.705),
      card("nightcrow", "ward", [100, 150], [41, 50], 160, 200, 0.705),
      card("nightcrow", "forethought", [90, 140], [51, 60], 150, 200, 0.705),
      card("standard", "sentinel", [30, 120], [29, 80], 130, 200, 0.295, "weak"),
      card("standard", "pulse", [40, 140], [19, 60], 150, 200, 0.295),
      card("standard", "spark", [50, 170], [9, 30], 180, 200, 0.295),
    ],
  };
  return {
    sample: true,
    baseline: mockCardsReport("broken"),
    patched: mockCardsReport("patched"),
    proposal: {
      patch: {
        baseDataHash: "",
        replacements: [{ path: "/gameRules/cards/5/cost", value: 3 }],
        rationale: "Sample: the crows cost one more so the Nightcrow deck wins about half its games.",
      },
      origin: "fake",
      changes: [{ path: "/gameRules/cards/5/cost", label: "Mechanical Crows · Cost", old: 2, new: 3 }],
      validation: { ok: true, errors: [] },
    },
    verdict: {
      verdict: "accepted",
      reasons: ["sample verdict; not computed"],
      targets: [
        {
          matchup: MATCHUP,
          before: { rate: 0.705, ci95: wilson(141, 200), games: 200 },
          after: { rate: 0.52, ci95: wilson(104, 200), games: 200 },
          outcome: "improved",
        },
      ],
    },
    cardDiagnosis: diagnosis,
  };
}
