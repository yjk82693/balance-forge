import type { Envelope } from "../lib/contract";
import { makeEnvelope } from "./envelope";
import type { ConnStatus, Role, Transport } from "./types";

const MAX_ENVELOPE = 64 * 1024; // contract: maximum envelope 64 KiB
const MAX_TRIES = 5;

const origin = () => `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;

interface HostRoom {
  roomId: string;
  hostToken: string;
}

const hostKey = (gameId: string) => `bf-host-${gameId}`;

function savedHostRoom(gameId: string): HostRoom | null {
  try {
    const raw = sessionStorage.getItem(hostKey(gameId));
    return raw ? (JSON.parse(raw) as HostRoom) : null;
  } catch {
    return null;
  }
}

function forgetHostRoom(gameId: string) {
  try {
    sessionStorage.removeItem(hostKey(gameId));
  } catch {
    /* storage blocked: nothing to forget */
  }
}

/**
 * The big screen's socket URL. The first time it creates a room over HTTP (POST /v1/rooms) and keeps the host token,
 * so a reload or a dropped socket re-attaches to the same room and join code instead of opening a new one.
 */
async function displayUrl(gameId: string): Promise<string> {
  let room = savedHostRoom(gameId);
  if (!room) {
    const res = await fetch("/v1/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId }),
    });
    if (!res.ok) throw new Error(`room create ${res.status}`);
    const body = (await res.json()) as HostRoom;
    room = { roomId: body.roomId, hostToken: body.hostToken };
    try {
      sessionStorage.setItem(hostKey(gameId), JSON.stringify(room));
    } catch {
      /* storage blocked: a reload will open a new room */
    }
  }
  return `${origin()}/ws?roomId=${encodeURIComponent(room.roomId)}&hostToken=${encodeURIComponent(room.hostToken)}`;
}

/**
 * One WebSocket with backoff reconnect. The server assigns the session id; every message after the first reply
 * carries the server's session id, room id and epoch (the server rejects stale ones).
 */
class Conn {
  private ws: WebSocket | null = null;
  private listeners = new Set<(env: Envelope) => void>();
  private statusFns = new Set<(s: ConnStatus) => void>();
  private status: ConnStatus = "connecting";
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private held = false; // drop() was called: stay down until reconnect()
  private reqSeq = 0;
  sessionId = "";
  private roomId = "";
  private epoch = 1;

  constructor(
    private readonly urlFor: () => Promise<string>,
    private readonly onServerError?: (env: Envelope) => void,
  ) {
    void this.open();
  }

  private setStatus(s: ConnStatus) {
    this.status = s;
    this.statusFns.forEach((f) => f(s));
  }

  private async open() {
    if (this.closed) return;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(await this.urlFor());
    } catch {
      return this.scheduleRetry();
    }
    if (this.closed) return ws.close();
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.setStatus("online");
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.sessionId = "";
      this.roomId = "";
      if (this.closed || this.held) return;
      this.setStatus("lost");
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private onMessage(data: unknown) {
    if (typeof data !== "string" || data.length > MAX_ENVELOPE) return;
    let env: Envelope;
    try {
      env = JSON.parse(data) as Envelope;
    } catch {
      return;
    }
    if (!env || typeof env.type !== "string") return;
    if (env.sessionId) this.sessionId = env.sessionId;
    if (env.roomId) this.roomId = env.roomId;
    if (Number.isInteger(env.epoch)) this.epoch = env.epoch;
    if (env.type === "error") this.onServerError?.(env);
    this.listeners.forEach((f) => f(env));
  }

  private scheduleRetry() {
    clearTimeout(this.timer);
    if (this.tries >= MAX_TRIES) {
      this.setStatus("lost"); // stop hammering a server that is not there; reconnect() tries again
      return;
    }
    const wait = Math.min(5000, 400 * 2 ** this.tries++);
    this.timer = setTimeout(() => void this.open(), wait);
  }

  send(type: string, payload: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const seq = (payload as { seq?: number } | null)?.seq ?? 0;
    const env = makeEnvelope(type, payload, {
      roomId: this.roomId,
      sessionId: this.sessionId,
      requestId: `q${++this.reqSeq}`,
      seq,
      epoch: this.epoch,
    });
    this.ws.send(JSON.stringify(env));
  }

  /** Drop the socket and open a fresh one (used when the stored host room turned out to be gone). */
  restart() {
    this.ws?.close();
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
    void this.open();
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

function acquireDisplay(gameId: string): Conn {
  if (shared && shared.gameId !== gameId) {
    shared.conn.close();
    shared = null;
  }
  if (!shared) {
    const conn: Conn = new Conn(
      () => displayUrl(gameId),
      (env) => {
        // The saved room is gone or already has a host: forget it and open a fresh room.
        const code = (env.payload as { code?: string } | null)?.code;
        if (code === "AUTH_EXPIRED" || code === "ILLEGAL_ACTION") {
          forgetHostRoom(gameId);
          conn.restart();
        }
      },
    );
    shared = { conn, refs: 0, gameId };
  }
  clearTimeout(shared.closeTimer);
  shared.refs += 1;
  return shared.conn;
}

function releaseDisplay() {
  const s = shared;
  if (!s) return;
  s.refs -= 1;
  if (s.refs > 0) return;
  s.closeTimer = setTimeout(() => {
    if (shared === s && s.refs <= 0) {
      s.conn.close();
      shared = null;
    }
  }, 1500);
}

const plainUrl = () => Promise.resolve(`${origin()}/ws`);

export function createWsTransport(role: Role, opts: { gameId?: string } = {}): Transport {
  const conn = role === "display" ? acquireDisplay(opts.gameId ?? "hero_arena") : new Conn(plainUrl);
  const mine = new Set<() => void>();
  let released = false;
  return {
    get sessionId() {
      return conn.sessionId;
    },
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
      if (role === "display") releaseDisplay();
      else conn.close();
    },
  };
}
