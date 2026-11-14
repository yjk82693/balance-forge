import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEvent, MatchConfig, MatchResult, Observation, RoomStatusPayload } from "../lib/contract";
import type { Transport } from "./transport";

export interface RoomView {
  room: RoomStatusPayload | null;
  observation: Observation<unknown> | null;
  /** events that came with the latest state.view (undefined if the server sent none) */
  events: GameEvent[] | undefined;
  /** from match.started, if seen */
  config: MatchConfig | null;
  result: MatchResult | null;
  error: { code: string; retryable: boolean; message?: string } | null;
  lastAckSeq: number;
}

/** One state.view as it arrived. */
export interface ViewPacket {
  observation: Observation;
  events: GameEvent[] | undefined;
}
export type ViewListener = (v: ViewPacket) => void;

const eventsOf = (payload: unknown): GameEvent[] | undefined => {
  const events = (payload as { events?: unknown })?.events;
  return Array.isArray(events) ? (events as GameEvent[]) : undefined;
};

/** Folds server envelopes into view state; used by display and controller screens alike. */
export function useRoom(transport: Transport | null): RoomView & { views: (fn: ViewListener) => () => void } {
  // Every state.view is handed to listeners at once, so a burst of packets is not collapsed into one render.
  const listeners = useRef(new Set<ViewListener>());
  const views = useCallback((fn: ViewListener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);
  const [v, setV] = useState<RoomView>({
    room: null,
    observation: null,
    events: undefined,
    config: null,
    result: null,
    error: null,
    lastAckSeq: -1,
  });
  useEffect(() => {
    if (!transport) return;
    return transport.subscribe((env) => {
      switch (env.type) {
        case "room.status":
          if (!Array.isArray((env.payload as RoomStatusPayload)?.seats)) return; // malformed: keep what we have
          return setV((s) => ({
            ...s,
            room: env.payload as RoomStatusPayload,
            error: null,
            result: (env.payload as RoomStatusPayload).phase === "playing" ? null : s.result,
          }));
        case "state.view":
          if (!(env.payload as { observation?: unknown })?.observation) return;
          for (const fn of listeners.current) {
            const observation = (env.payload as { observation: Observation }).observation;
            fn({ observation, events: eventsOf(env.payload) });
          }
          return setV((s) => ({
            ...s,
            observation: (env.payload as { observation: Observation<unknown> }).observation,
            events: eventsOf(env.payload),
          }));
        case "match.started":
          return setV((s) => ({ ...s, config: (env.payload as { config: MatchConfig }).config, result: null }));
        case "match.ended":
          if (!(env.payload as { result?: unknown })?.result) return;
          return setV((s) => ({ ...s, result: (env.payload as { result: MatchResult }).result }));
        case "input.ack":
          return setV((s) => ({ ...s, lastAckSeq: env.seq }));
        case "error":
          return setV((s) => ({ ...s, error: env.payload as { code: string; retryable: boolean } }));
      }
    });
  }, [transport]);
  return { ...v, views };
}
