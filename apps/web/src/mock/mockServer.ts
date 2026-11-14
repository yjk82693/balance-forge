import type {
  ActionInput,
  Envelope,
  MatchResult,
  Observation,
  RoomStatusPayload,
  Seat,
} from "../lib/contract";
import {
  fixtureMatchConfig,
  fixtureMatchEnded,
  fixtureObservation,
  fixtureRoomStatus,
  fixtureStateView,
} from "../lib/fixtures";
import { makeEnvelope } from "./envelope";
import { frameAt, loopLength, FRAME_MS as REPLAY_MS, type Version } from "../lib/replayGen";
import { CardsMock } from "./mockCards";

/** Actions the mock accepts; mirrors the action ids in fixtures (melee, projectile, guard) plus movement. */
export const ARENA_ACTIONS = ["move", "melee", "projectile", "guard"] as const;
const MAX_SEATS = 4;
const FRAME_MS = REPLAY_MS;

type Deliver = (env: Envelope) => void;

interface Session {
  id: string;
  role: "display" | "controller";
  seat?: string;
  deliver: Deliver;
}

/**
 * In-browser stand-in for the authoritative server. It speaks the WebSocket envelopes from
 * fixtures/ws_messages.json: room.status, input.submit -> input.ack, state.view, match.ended.
 * It never simulates a game; state.view frames replay the Observation fixture.
 */
export class MockServer {
  private sessions = new Map<string, Session>();
  private seats: Seat[];
  private phase: RoomStatusPayload["phase"] = "lobby";
  private seq = 1;
  private lastSeq = new Map<string, { seq: number; receipt: Envelope }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  readonly roomId = fixtureRoomStatus.roomId;
  readonly joinCode = fixtureRoomStatus.payload.joinCode;
  inputCount = 0;
  private gameId = "hero_arena";
  private version: Version = "broken";
  private cards: CardsMock | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Fixture seats carry no hero; the mock gives the two named judges the heroes in observation.json.
    const heroOf = new Map(fixtureObservation.payload.entities.map((e) => [e.id, e.hero]));
    this.seats = fixtureRoomStatus.payload.seats.map((s) => ({ ...s, hero: heroOf.get(s.seat) }));
  }

  connect(id: string, role: Session["role"], deliver: Deliver) {
    this.sessions.set(id, { id, role, deliver });
    if (role === "display") {
      // Deferred so the screen's subscriber is attached before the first messages arrive.
      setTimeout(() => {
        if (!this.sessions.has(id)) return;
        this.sendStatus(id);
        // A new display (e.g. lobby -> arena route change) resumes a match that is still running.
        if (this.phase === "playing" && this.cards) this.afterCardsChange();
        else if (this.phase === "playing" && !this.timer) this.timer = setInterval(() => this.sendFrame(), FRAME_MS);
      }, 60);
    }
  }

  disconnect(id: string) {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    if (s?.seat) {
      this.seats = this.seats.map((x) => (x.seat === s.seat ? { ...x, connected: false } : x));
      this.broadcastStatus();
    }
    if (![...this.sessions.values()].some((x) => x.role === "display")) this.stopReplay();
  }

  /** Entry point for every client message. */
  receive(from: string, env: Envelope) {
    const session = this.sessions.get(from);
    if (!session) return;
    switch (env.type) {
      case "room.join":
        return this.onJoin(session, env as Envelope<{ joinCode: string; name: string; hero?: string }>);
      case "input.submit":
        return this.onInput(session, env as Envelope<ActionInput>);
      case "game.select":
        if (session.role === "display") {
          this.gameId = String((env.payload as { gameId?: string }).gameId ?? "hero_arena");
          this.version = (env.payload as { dataVersion?: string }).dataVersion === "patched" ? "patched" : "broken";
          this.broadcastStatus();
        }
        return;
      case "match.start":
        return session.role === "display" ? this.startMatch() : this.error(session, env, "ILLEGAL_ACTION", false);
      case "match.reset":
        return session.role === "display" ? this.resetMatch() : undefined;
      case "ping":
        return this.to(session, "pong", {}, env);
    }
  }

  // ---- handlers ----

  private onJoin(s: Session, env: Envelope<{ joinCode: string; name: string; hero?: string }>) {
    const { joinCode, name, hero } = env.payload;
    if (joinCode.trim().toUpperCase() !== this.joinCode) return this.error(s, env, "AUTH_EXPIRED", true);
    // Reconnect keeps the seat; otherwise first seat nobody holds, then a new one.
    const held = new Set([...this.sessions.values()].map((x) => x.seat).filter(Boolean));
    let seat = this.seats.find((x) => !x.connected && !held.has(x.seat));
    if (!seat) {
      if (this.seats.length >= MAX_SEATS) return this.error(s, env, "ROOM_FULL", false);
      seat = { seat: `p${this.seats.length + 1}`, name: "", connected: false };
      this.seats.push(seat);
    }
    const id = seat.seat;
    this.seats = this.seats.map((x) =>
      x.seat === id ? { ...x, name: name.trim() || x.name, hero: hero ?? x.hero, connected: true } : x,
    );
    s.seat = id;
    this.broadcastStatus(s.id, id, env.requestId);
    if (this.phase === "playing") (this.cards ? this.afterCardsChange() : this.sendFrame());
  }

  private onInput(s: Session, env: Envelope<ActionInput>) {
    const a = env.payload;
    if (!s.seat || a.playerId !== s.seat) return this.error(s, env, "ILLEGAL_ACTION", false);
    if (this.cards) return this.onCardsInput(s, env);
    if (!(ARENA_ACTIONS as readonly string[]).includes(a.actionId)) return this.error(s, env, "ILLEGAL_ACTION", false);
    const prev = this.lastSeq.get(s.seat);
    if (prev && a.seq === prev.seq) return s.deliver(prev.receipt); // duplicate seq returns its receipt
    if (prev && a.seq < prev.seq) return this.error(s, env, "STALE_TURN", false);
    this.inputCount += 1;
    const receipt = makeEnvelope(
      "input.ack",
      { status: "accepted", acceptedTick: a.tick },
      { roomId: this.roomId, sessionId: s.id, requestId: env.requestId, seq: a.seq, epoch: 1 },
    );
    this.lastSeq.set(s.seat, { seq: a.seq, receipt });
    s.deliver(receipt);
  }

  private onCardsInput(s: Session, env: Envelope<ActionInput>) {
    const a = env.payload;
    const cards = this.cards!;
    const prev = this.lastSeq.get(s.seat!);
    if (prev && a.seq === prev.seq) return s.deliver(prev.receipt);
    let err: string | null = "ILLEGAL_ACTION";
    if (a.turnId !== cards.turnId) err = "STALE_TURN";
    else if (a.actionId === "play") err = cards.play(s.seat!, Number(a.params.handIndex));
    else if (a.actionId === "end_turn") err = cards.endTurn(s.seat!);
    if (err) return this.error(s, env, err, false);
    this.inputCount += 1;
    const receipt = makeEnvelope("input.ack", { status: "accepted", acceptedTick: a.tick }, { roomId: this.roomId, sessionId: s.id, requestId: env.requestId, seq: a.seq, epoch: 1 });
    this.lastSeq.set(s.seat!, { seq: a.seq, receipt });
    s.deliver(receipt);
    this.afterCardsChange();
  }

  private afterCardsChange() {
    const cards = this.cards;
    if (!cards) return;
    for (const s of this.sessions.values()) {
      const viewer = s.role === "display" ? "display" : (s.seat ?? "p?");
      this.to(s, "state.view", { observation: { tick: cards.tick, viewerId: viewer, payload: cards.view(viewer) }, viewHash: fixtureStateView.payload.viewHash });
    }
    if (!cards.running) {
      this.phase = "ended";
      const base = fixtureMatchEnded.payload.result;
      const result: MatchResult = { ...base, config: { ...base.config, gameId: "hero_cards", mode: "turn" }, outcome: cards.outcome, statistics: { ...base.statistics, durationTicks: cards.tick } };
      for (const s of this.sessions.values()) this.to(s, "match.ended", { result });
      this.broadcastStatus();
      return;
    }
    // A seat nobody is holding plays itself, so the table keeps moving in the demo.
    const held = new Set([...this.sessions.values()].map((x) => x.seat));
    clearTimeout(this.botTimer ?? undefined);
    if (!held.has(cards.active.id)) {
      this.botTimer = setTimeout(() => {
        cards.botStep();
        this.afterCardsChange();
      }, 900);
    }
  }

  private startMatch() {
    if (this.gameId === "hero_cards") {
      this.stopReplay();
      this.phase = "playing";
      this.cards = new CardsMock(["p1", "p2"]);
      this.broadcastStatus();
      for (const s of this.sessions.values()) this.to(s, "match.started", { config: { ...fixtureMatchConfig, gameId: "hero_cards", mode: "turn", players: ["p1", "p2"] } });
      this.afterCardsChange();
      return;
    }
    this.cards = null;
    this.phase = "playing";
    this.frame = 0;
    this.broadcastStatus();
    for (const s of this.sessions.values()) {
      this.to(s, "match.started", { config: { ...fixtureMatchConfig, gameId: this.gameId, players: this.seats.filter((x) => x.connected).map((x) => x.seat) } });
    }
    this.stopReplay();
    this.sendFrame();
    this.timer = setInterval(() => this.sendFrame(), FRAME_MS);
  }

  private resetMatch() {
    this.stopReplay();
    this.cards = null;
    this.phase = "lobby";
    this.broadcastStatus();
  }

  private stopReplay() {
    clearTimeout(this.botTimer ?? undefined);
    this.botTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---- outbound ----

  private sendFrame() {
    this.frame += 1;
    const heroOf = (id: string, d: string) => this.seats.find((x) => x.seat === id)?.hero ?? d;
    const obs = frameAt(this.frame, this.version, fixtureMatchConfig.seed, [heroOf("p1", "bari"), heroOf("p2", "real_armor")]);
    for (const s of this.sessions.values()) {
      const view: Observation = { ...obs, viewerId: s.role === "display" ? "display" : (s.seat ?? "p?") };
      this.to(s, "state.view", { observation: view, viewHash: fixtureStateView.payload.viewHash });
    }
    if (this.frame >= loopLength(this.version) - 1) {
      this.stopReplay();
      this.phase = "ended";
      const result: MatchResult = fixtureMatchEnded.payload.result;
      for (const s of this.sessions.values()) this.to(s, "match.ended", { result });
      this.broadcastStatus();
    }
  }

  private statusPayload(you?: string): RoomStatusPayload {
    return { joinCode: this.joinCode, gameId: this.gameId, phase: this.phase, seats: this.seats.map((x) => ({ ...x })), ...(you ? { you } : {}) };
  }

  private broadcastStatus(joiner?: string, seat?: string, requestId = "") {
    for (const s of this.sessions.values()) {
      const you = s.id === joiner ? seat : s.seat;
      this.to(s, "room.status", this.statusPayload(you), s.id === joiner ? { requestId } : undefined);
    }
  }

  private sendStatus(id: string) {
    const s = this.sessions.get(id);
    if (s) this.to(s, "room.status", this.statusPayload(s.seat));
  }

  private error(s: Session, req: Envelope, code: string, retryable: boolean) {
    this.to(s, "error", { code, retryable }, req);
  }

  private to(s: Session, type: string, payload: unknown, req?: { requestId?: string }) {
    s.deliver(
      makeEnvelope(type, payload, {
        roomId: this.roomId,
        sessionId: s.id,
        requestId: req?.requestId ?? "",
        seq: this.seq++,
        epoch: 1,
      }),
    );
  }
}

