import type { Envelope } from "../lib/contract";
import { makeEnvelope } from "./envelope";
import type { ConnStatus, Role, Transport } from "./types";

const MAX_ENVELOPE = 64 * 1024; // contract: maximum envelope 64 KiB

export function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

/** One WebSocket with backoff reconnect. Same envelopes as the mock, so screens don't care which one they have. */
class Conn {
  private ws: WebSocket | null = null;
  private listeners = new Set<(env: Envelope) => void>();
  private statusFns = new Set<(s: ConnStatus) => void>();
  private status: ConnStatus = "connecting";
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private held = false; // drop() was called: stay down until reconnect()
  private roomId = "";
  private reqSeq = 0;
  readonly sessionId = `${Math.random().toString(36).slice(2, 8)}`;

  constructor(private readonly onOpenMessages: () => [string, unknown][]) {
    this.open();
  }

  private setStatus(s: ConnStatus) {
    this.status = s;
    this.statusFns.forEach((f) => f(s));
  }

  private open() {
    if (this.closed) return;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      return this.scheduleRetry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.setStatus("online");
      for (const [type, payload] of this.onOpenMessages()) this.send(type, payload);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string" || ev.data.length > MAX_ENVELOPE) return;
      let env: Envelope;
      try {
        env = JSON.parse(ev.data) as Envelope;
      } catch {
        return;
      }
      if (!env || typeof env.type !== "string") return;
      if (env.roomId) this.roomId = env.roomId;
      this.listeners.forEach((f) => f(env));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed || this.held) return;
      this.setStatus("lost");
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry() {
    clearTimeout(this.timer);
    const wait = Math.min(5000, 400 * 2 ** this.tries++);
    this.timer = setTimeout(() => this.open(), wait);
  }

  send(type: string, payload: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const seq = (payload as { seq?: number } | null)?.seq ?? 0;
    this.ws.send(JSON.stringify(makeEnvelope(type, payload, { roomId: this.roomId, sessionId: this.sessionId, requestId: `q${++this.reqSeq}`, seq })));
  }

  subscribe(fn: (env: Envelope) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onStatus(fn: (s: ConnStatus) => void) {
    this.statusFns.add(fn);
    fn(this.status);
    return () => this.statusFns.delete(fn);
  }
  drop() {
    this.held = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setStatus("lost");
  }
  reconnect() {
    if (this.status === "online") return;
    this.held = false;
    clearTimeout(this.timer);
    this.tries = 0;
    this.open();
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.listeners.clear();
    this.statusFns.clear();
  }
}

// The big screen keeps one connection (and so one room) across lobby -> arena route changes.
let shared: { conn: Conn; refs: number; gameId: string; closeTimer?: ReturnType<typeof setTimeout> } | null = null;

export function createWsTransport(role: Role, opts: { gameId?: string; dataVersion?: string } = {}): Transport {
  let conn: Conn;
  const gameId = opts.gameId ?? "hero_arena";
  if (role === "display") {
    if (shared && shared.gameId !== gameId) {
      shared.conn.close();
      shared = null;
    }
    if (!shared) {
      const conn0 = new Conn(() => [["room.create", { gameId, seats: 4 }]]);
      shared = { conn: conn0, refs: 0, gameId };
    }
    clearTimeout(shared.closeTimer);
    shared.refs += 1;
    conn = shared.conn;
  } else {
    conn = new Conn(() => []);
  }
  const mine = new Set<() => void>();
  let released = false;
  return {
    sessionId: conn.sessionId,
    send: (t, p) => conn.send(t, p),
    subscribe(fn) {
      const off = conn.subscribe(fn);
      mine.add(off);
      return () => (mine.delete(off), off());
    },
    onStatus(fn) {
      const off = conn.onStatus(fn);
      mine.add(off);
      return () => (mine.delete(off), off());
    },
    drop: () => conn.drop(),
    reconnect: () => conn.reconnect(),
    close() {
      if (released) return;
      released = true;
      mine.forEach((off) => off());
      if (role === "display" && shared) {
        const s = shared;
        s.refs -= 1;
        if (s.refs <= 0) {
          s.closeTimer = setTimeout(() => {
            if (shared === s && s.refs <= 0) {
              s.conn.close();
              shared = null;
            }
          }, 1500);
        }
      } else conn.close();
    },
  };
}
