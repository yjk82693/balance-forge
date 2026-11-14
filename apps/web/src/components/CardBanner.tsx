import { useEffect, useRef, useState } from "react";
import { isCardsPayload, type CardsPayload, type GameEvent } from "../lib/contract";
import { CARDS, cardArtPath, cardName, effectWords } from "../lib/cards";
import { manifestUrl, preferWebp } from "../lib/assets";
import type { ViewListener } from "../mock/useRoom";

const SHOW_MS = 2800;
const TURN_MS = 1800;

type Item =
  | { kind: "card"; key: string; art?: string; title: string; who: string; words: string }
  | { kind: "turn"; key: string; words: string };

interface Props {
  /** every state.view as it arrives, so no event is missed when views come in a burst */
  views: (fn: ViewListener) => () => void;
  /** seat -> display name and seat -> hero id */
  names: Record<string, string>;
  heroes: Record<string, string>;
}

/** The events of one view as banners: each played card with its art and effect in words, and the turn passing. */
function itemsFrom(
  events: GameEvent[] | undefined,
  payload: CardsPayload,
  names: Props["names"],
  heroes: Props["heroes"],
  tick: number,
): Item[] {
  const nameOf = (seat: unknown) => names[String(seat)] ?? String(seat);
  const out: Item[] = [];
  for (const ev of events ?? []) {
    const key = `${tick}:${ev.eventId}`;
    if (ev.kind === "card.played") {
      const card = CARDS.find((c) => c.id === ev.payload.cardId);
      if (!card) continue;
      const hit = events?.find((e) => e.kind === "card.hit" && e.payload.source === ev.payload.playerId);
      const other = payload.entities.find((e) => e.id !== ev.payload.playerId)?.id;
      const foe = hit ? nameOf(hit.payload.target) : nameOf(other);
      const hero = heroes[String(ev.payload.playerId)] ?? "bari";
      const art = manifestUrl(preferWebp(cardArtPath(hero, card)));
      const dealt = hit ? Number(hit.payload.amount) : undefined;
      out.push({
        kind: "card",
        key,
        art,
        title: cardName(card.id),
        who: `${nameOf(ev.payload.playerId)} played`,
        words: effectWords(card, nameOf(ev.payload.playerId), foe, dealt),
      });
    } else if (ev.kind === "turn.ended") {
      out.push({ kind: "turn", key, words: `Round ${payload.round} of 6 · ${nameOf(payload.activePlayer)}'s turn` });
    }
  }
  return out;
}

/** Shows played cards and turn changes over the table, one at a time, each for a few seconds. */
export function CardBanner({ views, names, heroes }: Props) {
  const queue = useRef<Item[]>([]);
  const seen = useRef(new Set<string>());
  const [current, setCurrent] = useState<Item | null>(null);
  const latest = useRef({ names, heroes });
  latest.current = { names, heroes };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false; // a banner is on screen and the next one is scheduled
    const next = () => {
      const item = queue.current.shift() ?? null;
      running = !!item;
      setCurrent(item);
      if (item) timer = setTimeout(next, item.kind === "card" ? SHOW_MS : TURN_MS);
    };
    const off = views((v) => {
      const payload: unknown = v.observation.payload;
      if (!isCardsPayload(payload) || !v.events?.length) return;
      const { names: n, heroes: h } = latest.current;
      const fresh = itemsFrom(v.events, payload, n, h, v.observation.tick).filter((i) => !seen.current.has(i.key));
      for (const i of fresh) seen.current.add(i.key);
      queue.current.push(...fresh);
      if (queue.current.length > 6) queue.current.splice(0, queue.current.length - 6); // never fall far behind
      if (!running) next();
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [views]);

  if (!current) return null;
  return current.kind === "card" ? (
    <div className="card-banner" role="status" key={current.key}>
      {current.art && <img src={current.art} alt="" width={96} height={72} />}
      <div>
        <p className="caption">{current.who}</p>
        <p className="h3">{current.title}</p>
        <p className="small">{current.words}</p>
      </div>
    </div>
  ) : (
    <div className="turn-chip" role="status" key={current.key}>
      {current.words}
    </div>
  );
}
