import type { CardDiagnosis, CardLever, CardRow } from "../lib/api";
import { manifestUrl, preferWebp, useManifest } from "../lib/assets";
import { CARDS, cardArtPath, cardEffect, cardName } from "../lib/cards";
import { heroName } from "../lib/heroes";
import { pct } from "../lib/stats";
import { MIN_GAMES } from "./WinRateChart";

/** Thumbnail of a card: its own art, 40 px wide. The "standard" deck has no hero of its own, so Bari's guard art. */
export function CardThumb({ cardId, deck }: { cardId: string; deck?: string }) {
  useManifest();
  const card = CARDS.find((c) => c.id === cardId);
  const hero = deck && deck !== "standard" ? deck : "bari";
  const src = card ? manifestUrl(preferWebp(cardArtPath(hero, card))) : undefined;
  return src ? (
    <img className="card-thumb" src={src} alt="" width={40} height={30} loading="lazy" />
  ) : (
    <span className="card-thumb card-thumb-empty" aria-hidden="true" />
  );
}

const rateText = (r: number | null) => (r === null ? "—" : `${pct(r)}%`);
const ciText = (ci: [number, number]) => `${pct(ci[0])}–${pct(ci[1])}%`;

function CardLine({ row }: { row: CardRow }) {
  const def = CARDS.find((c) => c.id === row.cardId);
  const few = row.played.games < MIN_GAMES;
  const flag = row.dominant ? { cls: "status warn", text: "▲ above its deck" } : row.weak
    ? { cls: "status warn", text: "▲ below its deck" }
    : null;
  return (
    <tr className={row.dominant || row.weak ? "card-flag" : undefined}>
      <td className="card-name">
        <CardThumb cardId={row.cardId} deck={row.deck} />
        <span>
          <span className="small">{cardName(row.cardId)}</span>
          {def && (
            <span className="small text-2">
              cost {def.cost} · {cardEffect(def)}
            </span>
          )}
        </span>
      </td>
      <td className="small">{rateText(row.playRate)}</td>
      <td className="small" title={`95% CI ${ciText(row.played.ci95)} · n = ${row.played.games}`}>
        {few ? "Too few games" : `${rateText(row.played.winRate)}`}
        <span className="small text-2"> n = {row.played.games}</span>
      </td>
      <td className="small" title={`95% CI ${ciText(row.notPlayed.ci95)} · n = ${row.notPlayed.games}`}>
        {row.notPlayed.games < MIN_GAMES ? "Too few games" : rateText(row.notPlayed.winRate)}
        <span className="small text-2"> n = {row.notPlayed.games}</span>
      </td>
      <td>{flag && <span className={flag.cls}>{flag.text}</span>}</td>
    </tr>
  );
}

/**
 * The card table, one block per deck: how often each card is played when it could be, and how the deck's player did
 * when they played it against when they held it and did not. A flag compares the card with its own deck, not with 50%.
 */
export function CardTable({ diagnosis }: { diagnosis: CardDiagnosis }) {
  const decks = [...new Set(diagnosis.cards.map((c) => c.deck))];
  if (!decks.length) return <p className="text-2">No card table in this run.</p>;
  return (
    <div className="card-table">
      {decks.map((deck) => {
        const rows = diagnosis.cards.filter((c) => c.deck === deck);
        const rate = rows[0]?.deckWinRate ?? null;
        return (
          <div key={deck}>
            <p className="eyebrow">
              {heroName(deck)}
              {deck !== "standard" ? " deck" : ""} · wins {rateText(rate)} overall
            </p>
            <table className="card-grid">
              <thead>
                <tr>
                  <th className="small text-2">Card</th>
                  <th className="small text-2">Played when possible</th>
                  <th className="small text-2">Win when played</th>
                  <th className="small text-2">Win when held, not played</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <CardLine key={`${r.deck}-${r.cardId}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="small text-2">
        Flags compare a card with its own deck (the whole 95% interval above or below the deck's), with at least{" "}
        {MIN_GAMES} games.
      </p>
    </div>
  );
}

const points = (effect: number) => {
  const sign = effect > 0 ? "+" : effect < 0 ? "−" : "";
  return `${sign}${Math.abs(Math.round(effect * 100))} pts`;
};

function LeverLine({ l, deck }: { l: CardLever; deck: string }) {
  return (
    <li className={`lever${l.significant ? " significant" : ""}`}>
      <CardThumb cardId={l.cardId} />
      <span className="small lever-what">
        {cardName(l.cardId)} · {l.field} {l.from} → {l.to}
      </span>
      <span
        className="small lever-effect"
        title={`${heroName(deck)} wins ${pct(l.rate)}% with this change (${l.games} games)`}
      >
        {points(l.effect)}
      </span>
      <span className={l.significant ? "status ok" : "badge"}>{l.significant ? "significant" : "within noise"}</span>
      {l.towardTarget && <span className="small text-2">toward the target</span>}
    </li>
  );
}

/** The measured card levers, the biggest move toward the target first. Significant ones are marked. */
export function LeverList({ diagnosis }: { diagnosis: CardDiagnosis }) {
  const sign = diagnosis.direction === "up" ? 1 : -1;
  const levers = [...diagnosis.levers].sort((a, b) => (b.effect - a.effect) * sign);
  if (!levers.length) return <p className="text-2">No card lever was measured.</p>;
  const base = diagnosis.probeBaseline;
  return (
    <div className="levers">
      <p className="small">
        Each change was run on the same seeds as the unchanged data ({base.games} games,{" "}
        {heroName(diagnosis.focalDeck)} wins {pct(base.rate)}%). Effect = {heroName(diagnosis.focalDeck)}'s win rate
        with the change minus without it.
      </p>
      <ul className="lever-list">
        {levers.map((l) => (
          <LeverLine key={`${l.path}-${l.to}`} l={l} deck={diagnosis.focalDeck} />
        ))}
      </ul>
      <p className="small text-2">
        {diagnosis.probed} changes probed, {diagnosis.significantLevers} significant (beyond 1.96 standard errors).
        Shown: the ones that move toward {pct(diagnosis.target)}%, else the three closest.
      </p>
    </div>
  );
}
