import type { CardDef, CardsPayload, Outcome } from "../lib/contract";
import { CARDS, CARDS_RULES } from "../lib/cards";

interface Unit {
  id: string;
  power: number;
  sleepUntil: number;
}
interface Side {
  id: string;
  hp: number;
  energy: number;
  ward: number;
  hand: CardDef[];
  deck: CardDef[];
  discard: CardDef[];
  units: Unit[];
}

/**
 * Stand-in for the cards engine, used only with ?mock=1 so the table and the phone hand can be exercised
 * without the server. Same rules shape as packages/games/cards, but deterministic and simplified;
 * never a source of results.
 */
export class CardsMock {
  turnId = 0;
  tick = 0;
  outcome: Outcome = { status: "running", winners: [], reason: "in_progress" };
  private sides: Side[];
  private nextUnit = 0;

  constructor(ids: [string, string]) {
    this.sides = ids.map((id, i) => {
      const deck = Array.from({ length: 3 }, () => CARDS).flat();
      const rotated = [...deck.slice(i * 2), ...deck.slice(0, i * 2)];
      const s: Side = {
        id,
        hp: CARDS_RULES.health,
        energy: 3,
        ward: 0,
        hand: [],
        deck: rotated,
        discard: [],
        units: [],
      };
      this.refill(s);
      return s;
    });
  }

  get active(): Side {
    return this.sides[this.turnId % 2];
  }
  get running() {
    return this.outcome.status === "running";
  }

  private refill(s: Side) {
    while (s.hand.length < CARDS_RULES.handSize) {
      if (!s.deck.length) {
        if (!s.discard.length) break;
        s.deck = s.discard.reverse();
        s.discard = [];
      }
      s.hand.push(s.deck.pop()!);
    }
  }

  playable(s: Side, c: CardDef | undefined): boolean {
    return !!c && c.cost <= s.energy && (c.kind !== "summon" || s.units.length < CARDS_RULES.summonSlots);
  }

  /** @returns an error code, or null when accepted */
  play(seat: string, handIndex: number): string | null {
    const s = this.active;
    if (!this.running || s.id !== seat) return "STALE_TURN";
    const card = s.hand[handIndex];
    if (!this.playable(s, card)) return "ILLEGAL_ACTION";
    s.hand.splice(handIndex, 1);
    s.discard.push(card);
    s.energy -= card.cost;
    const enemy = this.sides[(this.turnId + 1) % 2];
    if (card.kind === "summon") s.units.push({ id: `u${this.nextUnit++}`, power: card.power, sleepUntil: 0 });
    else if (card.kind === "ward") s.ward = Math.min(100, s.ward + card.power);
    else {
      this.damage(enemy, card.power, card.ignoresWard);
      if (card.kind === "hypnosis") for (const u of enemy.units) u.sleepUntil = this.turnId + 2;
    }
    this.tick += 1;
    if (enemy.hp === 0) this.outcome = { status: "win", winners: [s.id], reason: "hp_zero" };
    else if (s.energy === 0) this.endTurn(seat);
    return null;
  }

  endTurn(seat: string): string | null {
    const s = this.active;
    if (!this.running || s.id !== seat) return "STALE_TURN";
    const enemy = this.sides[(this.turnId + 1) % 2];
    for (const u of s.units) if (u.sleepUntil <= this.turnId) this.damage(enemy, u.power, false);
    this.turnId += 1;
    this.tick += 1;
    if (enemy.hp === 0) this.outcome = { status: "win", winners: [s.id], reason: "hp_zero" };
    else if (this.turnId >= CARDS_RULES.rounds * 2) {
      const [a, b] = this.sides;
      this.outcome = a.hp === b.hp ? {
        status: "draw",
        winners: [],
        reason: "six_rounds",
      } : { status: "win", winners: [a.hp > b.hp ? a.id : b.id], reason: "six_rounds" };
    } else {
      const next = this.active;
      next.energy = CARDS_RULES.energy;
      this.refill(next);
    }
    return null;
  }

  private damage(target: Side, amount: number, ignoresWard: boolean) {
    const absorbed = ignoresWard ? 0 : Math.min(amount, target.ward);
    target.ward -= absorbed;
    target.hp = Math.max(0, target.hp - (amount - absorbed));
  }

  /** Bot move for the active seat: first playable card, else end the turn. */
  botStep() {
    const s = this.active;
    const i = s.hand.findIndex((c) => this.playable(s, c));
    if (i >= 0) this.play(s.id, i);
    else this.endTurn(s.id);
  }

  view(viewer: string): CardsPayload {
    return {
      activePlayer: this.active.id,
      round: Math.min(CARDS_RULES.rounds, Math.floor(this.turnId / 2) + 1),
      turnId: Math.min(12, this.turnId),
      entities: this.sides.map((s) => ({
        id: s.id,
        hp: s.hp,
        maxHp: CARDS_RULES.health,
        energy: s.energy,
        ward: s.ward,
        handCount: s.hand.length,
        deckCount: s.deck.length,
        units: s.units.map((u) => ({ ...u })),
      })),
      hand: this.sides.find((s) => s.id === viewer)?.hand.map((c) => ({ ...c })) ?? [],
      outcome: { ...this.outcome, winners: [...this.outcome.winners] },
    };
  }
}
