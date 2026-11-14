import type { CardDiagnosis, CardLever, CardRow, CardSide } from "./api";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function cardSide(raw: unknown): CardSide | null {
  if (!isObject(raw) || !Number.isFinite(raw.games) || !Number.isFinite(raw.wins)) return null;
  const ci = Array.isArray(raw.ci95) && raw.ci95.length === 2 ? raw.ci95 : [0, 1];
  return {
    wins: Number(raw.wins),
    games: Number(raw.games),
    winRate: num(raw.winRate) ?? null,
    ci95: [Number(ci[0]), Number(ci[1])],
  };
}

function cardRow(raw: unknown): CardRow | null {
  if (!isObject(raw) || typeof raw.deck !== "string" || typeof raw.cardId !== "string") return null;
  const played = cardSide(raw.played);
  const notPlayed = cardSide(raw.notPlayed);
  if (!played || !notPlayed) return null;
  return {
    deck: raw.deck,
    cardId: raw.cardId,
    plays: num(raw.plays) ?? 0,
    opportunities: num(raw.opportunities) ?? 0,
    playRate: num(raw.playRate) ?? null,
    played,
    notPlayed,
    deckWinRate: num(raw.deckWinRate) ?? null,
    dominant: raw.dominant === true,
    weak: raw.weak === true,
  };
}

function cardLever(raw: unknown): CardLever | null {
  if (!isObject(raw) || typeof raw.path !== "string" || typeof raw.cardId !== "string") return null;
  const [from, to, effect] = [num(raw.from), num(raw.to), num(raw.effect)];
  if (from === undefined || to === undefined || effect === undefined) return null;
  if (raw.field !== "cost" && raw.field !== "power") return null;
  return {
    path: raw.path,
    cardId: raw.cardId,
    field: raw.field,
    from,
    to,
    rate: num(raw.rate) ?? 0,
    games: num(raw.games) ?? 0,
    effect,
    significant: raw.significant === true,
    towardTarget: raw.towardTarget === true,
  };
}

/**
 * Hero Cards `diagnosis` (kind "cards"): the measured card levers and the per-deck card table. Null for any other
 * diagnosis or when it has no usable lever and no card row.
 */
export function cardDiagnosisFrom(raw: unknown): CardDiagnosis | null {
  if (!isObject(raw) || raw.kind !== "cards" || typeof raw.matchup !== "string") return null;
  const levers = (Array.isArray(raw.levers) ? raw.levers : []).flatMap((l) => cardLever(l) ?? []);
  const table = isObject(raw.cards) ? raw.cards : null;
  const cards = (Array.isArray(table?.cards) ? (table.cards as unknown[]) : []).flatMap((c) => cardRow(c) ?? []);
  const decks = (Array.isArray(table?.decks) ? (table.decks as unknown[]) : []).flatMap((d) =>
    isObject(d) && typeof d.deck === "string" && Number.isFinite(d.wins) && Number.isFinite(d.games)
      ? [{ deck: d.deck, wins: Number(d.wins), games: Number(d.games), winRate: num(d.winRate) ?? null }]
      : [],
  );
  if (!levers.length && !cards.length) return null;
  const base = isObject(raw.probeBaseline) ? raw.probeBaseline : {};
  const ci = Array.isArray(base.ci95) && base.ci95.length === 2 ? base.ci95 : [0, 1];
  return {
    matchup: raw.matchup,
    focalDeck: typeof raw.focalDeck === "string" ? raw.focalDeck : raw.matchup.split(" vs ")[0],
    focalRate: num(raw.focalRate) ?? 0.5,
    target: num(raw.target) ?? 0.5,
    direction: raw.direction === "up" ? "up" : "down",
    probeBaseline: { rate: num(base.rate) ?? 0, games: num(base.games) ?? 0, ci95: [Number(ci[0]), Number(ci[1])] },
    levers,
    probed: num(raw.probed) ?? levers.length,
    significantLevers: num(raw.significantLevers) ?? levers.filter((l) => l.significant).length,
    decks,
    cards,
  };
}
