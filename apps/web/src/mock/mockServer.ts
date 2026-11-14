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

/** Actions the mock accepts; mirrors the action ids in fixtures (melee, projectile, guard) plus movement. */
export const ARENA_ACTIONS = ["move", "melee", "projectile", "guard"] as const;
const MAX_SEATS = 4;
const FRAME_MS = 100;
const REPLAY_FRAMES = 60;

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

  constructor() {
    // Fixture seats carry no hero; the mock gives the two named judges the heroes in observation.json.
    const heroOf = new Map(fixtureObservation.payload.entities.map((e) => [e.id, e.hero]));
    this.seats = fixtureRoomStatus.payload.seats.map((s) => ({ ...s, hero: heroOf.get(s.seat) }));
  }

  connect(id: string, role: Session["role"], deliver: Deliver) {
    this.sessions.set(id, { id, role, deliver });
    if (role === "display") {
      this.sendStatus(id);
      // A new display (e.g. lobby -> arena route change) resumes a match that is still running.
      if (this.phase === "playing" && !this.timer) this.timer = setInterval(() => this.sendFrame(), FRAME_MS);
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
    if (this.phase === "playing") this.sendFrame();
  }

  private onInput(s: Session, env: Envelope<ActionInput>) {
    const a = env.payload;
    if (!s.seat || a.playerId !== s.seat) return this.error(s, env, "ILLEGAL_ACTION", false);
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

  private startMatch() {
    this.phase = "playing";
    this.frame = 0;
    this.broadcastStatus();
    for (const s of this.sessions.values()) {
      this.to(s, "match.started", { config: { ...fixtureMatchConfig, players: this.seats.filter((x) => x.connected).map((x) => x.seat) } });
    }
    this.stopReplay();
    this.sendFrame();
    this.timer = setInterval(() => this.sendFrame(), FRAME_MS);
  }

  private resetMatch() {
    this.stopReplay();
    this.phase = "lobby";
    this.broadcastStatus();
  }

  private stopReplay() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---- outbound ----

  private sendFrame() {
    this.frame += 1;
    const obs = replayObservation(this.frame, this.seats);
    for (const s of this.sessions.values()) {
      const view: Observation = { ...obs, viewerId: s.role === "display" ? "display" : (s.seat ?? "p?") };
      this.to(s, "state.view", { observation: view, viewHash: fixtureStateView.payload.viewHash });
    }
    if (this.frame >= REPLAY_FRAMES) {
      this.stopReplay();
      this.phase = "ended";
      const result: MatchResult = fixtureMatchEnded.payload.result;
      for (const s of this.sessions.values()) this.to(s, "match.ended", { result });
      this.broadcastStatus();
    }
  }

  private statusPayload(you?: string): RoomStatusPayload {
    return { joinCode: this.joinCode, phase: this.phase, seats: this.seats.map((x) => ({ ...x })), ...(you ? { you } : {}) };
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

/** Deterministic visual replay of the fixture Observation: integer positions, the arrow flies p1 -> p2 on a loop. */
export function replayObservation(frame: number, seats: Seat[]): Observation {
  const base = fixtureObservation;
  const [p1, p2] = base.payload.entities;
  const span = p2.x - p1.x;
  const cycle = 20;
  const t = frame % cycle;
  const arrowX = p1.x + Math.trunc((span * t) / cycle);
  const heroOf = new Map(seats.map((s) => [s.seat, s.hero]));
  return {
    tick: base.tick + frame * 6,
    viewerId: "display",
    payload: {
      ...base.payload,
      entities: base.payload.entities.map((e) => ({ ...e, hero: heroOf.get(e.id) ?? e.hero })),
      projectiles: base.payload.projectiles.map((p) => ({ ...p, x: arrowX })),
    },
  };
}
