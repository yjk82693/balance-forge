import { useRef, useState } from "react";
import type { CardDef, CardsPayload } from "../lib/contract";
import { CARDS_RULES, cardArtPath, cardEffect, cardName } from "../lib/cards";
import { manifestUrl } from "../lib/assets";
import type { ActionInput } from "../lib/contract";
import { blip, buzz } from "../lib/sfx";

interface Props {
  seat: string;
  hero: string;
  payload: CardsPayload | null;
  tick: number;
  names: Record<string, string>;
  online: boolean;
  send: (input: ActionInput) => void;
}

function Orbs({ n }: { n: number }) {
  return (
    <span className="orbs" role="img" aria-label={`${n} of ${CARDS_RULES.energy} energy`}>
      {Array.from({ length: CARDS_RULES.energy }, (_, i) => (
        <i key={i} className={`orb${i < n ? " on" : ""}`} />
      ))}
    </span>
  );
}

/** Phone hand: five cards, energy, summon slots, turn counter, end-turn. Sends `play` / `end_turn` ActionInputs. */
export function CardsHand({ seat, hero, payload, tick, names, online, send }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const seq = useRef(0);
  const me = payload?.entities.find((e) => e.id === seat);
  const foe = payload?.entities.find((e) => e.id !== seat);
  const over = payload ? payload.outcome.status !== "running" : false;
  const mine = !!payload && payload.activePlayer === seat && !over;
  const hand = payload?.hand ?? [];

  const reasonFor = (c: CardDef): string => {
    if (!me) return "";
    if (c.cost > me.energy) return "Not enough energy";
    if (c.kind === "summon" && me.units.length >= CARDS_RULES.summonSlots) return "Both summon slots are full";
    return "";
  };
  const card = picked != null ? hand[picked] : undefined;
  const blocked = card ? reasonFor(card) : "";

  const emit = (actionId: string, params: Record<string, number>) => {
    if (!payload) return;
    buzz(10);
    blip(actionId === "end_turn" ? "turn" : "play");
    send({ playerId: seat, seq: ++seq.current, tick: tick + 1, turnId: payload.turnId, actionId, params });
  };
  const play = () => {
    if (picked == null || !card || !mine || blocked || !me) return;
    emit("play", card.kind === "summon" ? { handIndex: picked, slot: me.units.length } : { handIndex: picked });
    setPicked(null);
  };
  const turnLabel = over ? "Match over" : mine ? "Your turn" : `Waiting for ${names[payload?.activePlayer ?? ""] ?? "the other player"}`;

  return (
    <div className="hand">
      <section className="hand-top" aria-live="polite">
        <p className="caption">{payload ? `Round ${payload.round} of ${CARDS_RULES.rounds}` : "Waiting for the host to start"}</p>
        <p className="h3">{payload ? turnLabel : "Hold tight."}</p>
        {me && (
          <div className="hand-stats">
            <Orbs n={me.energy} />
            <span className="small">HP {me.hp}/{me.maxHp ?? CARDS_RULES.health}</span>
            <span className="small">Ward {me.ward}</span>
            {foe && <span className="caption">{names[foe.id] ?? foe.id}: HP {foe.hp}</span>}
          </div>
        )}
        {me && (
          <div className="slots" aria-label="Your summon slots">
            {Array.from({ length: CARDS_RULES.summonSlots }, (_, i) => {
              const u = me.units[i];
              return (
                <span key={i} className={`slot${u ? " full" : ""}`}>
                  {u ? `Unit · ${u.power} per turn${u.sleepUntil > payload!.turnId ? " · asleep" : ""}` : "Open summon slot"}
                </span>
              );
            })}
          </div>
        )}
      </section>

      <ul className="cards" role="listbox" aria-label="Your hand">
        {hand.map((c, i) => {
          const why = reasonFor(c);
          const art = manifestUrl(cardArtPath(hero, c));
          const sel = picked === i;
          return (
            <li key={`${c.id}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={sel}
                className={`hcard${sel ? " sel" : ""}${why || !mine ? " off" : ""}`}
                disabled={!online || over}
                onClick={() => setPicked(sel ? null : i)}
              >
                <span className="hcard-art" style={art ? { backgroundImage: `url(${art})` } : undefined} />
                <span className="hcard-cost" aria-label={`Cost ${c.cost}`}>
                  {c.cost}
                </span>
                <span className="hcard-name">{cardName(c.id)}</span>
                <span className="hcard-fx">{cardEffect(c)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="caption hand-reason" aria-live="polite">
        {!mine || over ? "" : blocked || (card ? "" : "Tap a card to pick it.")}
      </p>
      <div className="hand-actions">
        <button className="btn primary touch" aria-disabled={!mine || !card || !!blocked} onClick={play}>
          Play card
        </button>
        <button className="btn secondary touch" aria-disabled={!mine} onClick={() => mine && (setPicked(null), emit("end_turn", {}))}>
          End turn
        </button>
      </div>
    </div>
  );
}
