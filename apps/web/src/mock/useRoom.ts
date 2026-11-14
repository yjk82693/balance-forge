import { useEffect, useState } from "react";
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

const eventsOf = (payload: unknown): GameEvent[] | undefined => {
  const events = (payload as { events?: unknown })?.events;
  return Array.isArray(events) ? (events as GameEvent[]) : undefined;
};

/** Folds server envelopes into view state; used by display and controller screens alike. */
export function useRoom(transport: Transport | null): RoomView {
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
  return v;
}
