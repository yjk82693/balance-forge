import { useEffect, useState } from "react";
import type { Envelope } from "../lib/contract";
import { makeEnvelope } from "./envelope";
import { MockServer } from "./mockServer";
import { createWsTransport } from "./ws";
import { isMockMode, type ConnStatus, type Role, type Transport } from "./types";

export type { ConnStatus, Role, Transport };

/*
 * Cross-tab wiring. The display tab owns the MockServer for its whole lifetime (it survives route changes);
 * controller tabs reach it over BroadcastChannel. A controller opened with no display tab open hosts a private
 * room of its own, so the phone screen still works alone.
 */
type Wire =
  | { k: "hello"; from: string }
  | { k: "host"; to: string }
  | { k: "up"; from: string; connect?: Role; env?: Envelope; bye?: boolean }
  | { k: "down"; to: string; env: Envelope };

let server: MockServer | null = null;
let displaysHere = 0; // display transports alive in this tab: only then do we serve other tabs
const remoteHandlers = new Map<string, (m: Wire) => void>();

const chan = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("balance-forge-mock-v1") : null;
chan?.addEventListener("message", (ev: MessageEvent<Wire>) => {
  const m = ev.data;
  if (m.k === "hello" && server && displaysHere > 0) chan.postMessage({ k: "host", to: m.from } satisfies Wire);
  else if (m.k === "host" || m.k === "down") remoteHandlers.get(m.to)?.(m);
  else if (m.k === "up" && server && displaysHere > 0) {
    if (m.connect) server.connect(m.from, m.connect, (env) => chan.postMessage({ k: "down", to: m.from, env } satisfies Wire));
    else if (m.bye) server.disconnect(m.from);
    else if (m.env) server.receive(m.from, m.env);
  }
});

const getServer = () => (server ??= new MockServer());
let counter = 0;
const newId = (role: Role) => `${role === "display" ? "display" : "ctrl"}-${Math.random().toString(36).slice(2, 7)}${++counter}`;

function createMockTransport(role: Role): Transport {
  const sessionId = newId(role);
  const listeners = new Set<(env: Envelope) => void>();
  const statusFns = new Set<(s: ConnStatus) => void>();
  let reqSeq = 0;
  let mode: "local" | "remote" | "none" = "none";
  let status: ConnStatus = "connecting";
  let closed = false;
  let helloTimer: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (s: ConnStatus) => {
    status = s;
    statusFns.forEach((f) => f(s));
  };
  const deliver = (env: Envelope) => {
    if (env.sessionId === sessionId || env.sessionId === "") listeners.forEach((f) => f(env));
  };

  const attachLocal = () => {
    mode = "local";
    if (role === "display") displaysHere += 1;
    getServer().connect(sessionId, role, deliver);
    setStatus("online");
  };

  const connect = () => {
    setStatus("connecting");
    if (role === "display" || !chan) return attachLocal();
    remoteHandlers.set(sessionId, (m) => {
      if (m.k === "host") {
        clearTimeout(helloTimer);
        mode = "remote";
        chan.postMessage({ k: "up", from: sessionId, connect: role } satisfies Wire);
        setStatus("online");
      } else if (m.k === "down") deliver(m.env);
    });
    chan.postMessage({ k: "hello", from: sessionId } satisfies Wire);
    helloTimer = setTimeout(() => {
      if (status === "connecting" && !closed) attachLocal();
    }, 350);
  };

  const detach = () => {
    if (mode === "remote") chan?.postMessage({ k: "up", from: sessionId, bye: true } satisfies Wire);
    else if (mode === "local") {
      getServer().disconnect(sessionId);
      if (role === "display") displaysHere -= 1;
    }
    mode = "none";
  };

  connect();

  return {
    sessionId,
    send(type, payload) {
      if (status !== "online" || closed) return;
      const seq = (payload as { seq?: number } | null)?.seq ?? 0;
      const env = makeEnvelope(type, payload, { sessionId, requestId: `q${++reqSeq}`, seq });
      if (mode === "remote") chan!.postMessage({ k: "up", from: sessionId, env } satisfies Wire);
      else getServer().receive(sessionId, env);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onStatus(fn) {
      statusFns.add(fn);
      fn(status);
      return () => statusFns.delete(fn);
    },
    drop() {
      if (status !== "online") return;
      detach();
      setStatus("lost");
    },
    reconnect() {
      if (closed || status !== "lost") return;
      connect();
    },
    close() {
      closed = true;
      clearTimeout(helloTimer);
      detach();
      remoteHandlers.delete(sessionId);
      listeners.clear();
      statusFns.clear();
    },
  };
}

export function createTransport(role: Role, opts: { gameId?: string } = {}): Transport {
  return isMockMode() ? createMockTransport(role) : createWsTransport(role, opts);
}

/** One transport per mounted screen, closed on unmount. Real /ws by default, mock with ?mock=1. */
export function useTransport(role: Role, gameId?: string) {
  const [transport, setTransport] = useState<Transport | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  useEffect(() => {
    const t = createTransport(role, { gameId });
    setTransport(t);
    const off = t.onStatus(setStatus);
    return () => {
      off();
      t.close();
      setTransport(null);
    };
  }, [role, gameId]);
  return { transport, status };
}
