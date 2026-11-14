import { useEffect, useState } from "react";
import type { MatchConfig, MatchResult, Observation, RoomStatusPayload } from "../lib/contract";
import type { Transport } from "./transport";

export interface RoomView {
  room: RoomStatusPayload | null;
  observation: Observation<unknown> | null;
  /** from match.started, if seen */
  config: MatchConfig | null;
  result: MatchResult | null;
  error: { code: string; retryable: boolean } | null;
  lastAckSeq: number;
}

/** Folds server envelopes into view state; used by display and controller screens alike. */
export function useRoom(transport: Transport | null): RoomView {
  const [v, setV] = useState<RoomView>({ room: null, observation: null, config: null, result: null, error: null, lastAckSeq: -1 });
  useEffect(() => {
    if (!transport) return;
    return transport.subscribe((env) => {
      switch (env.type) {
        case "room.status":
          return setV((s) => ({
            ...s,
            room: env.payload as RoomStatusPayload,
            error: null,
            result: (env.payload as RoomStatusPayload).phase === "playing" ? null : s.result,
          }));
        case "state.view":
          return setV((s) => ({ ...s, observation: (env.payload as { observation: Observation<unknown> }).observation }));
        case "match.started":
          return setV((s) => ({ ...s, config: (env.payload as { config: MatchConfig }).config, result: null }));
        case "match.ended":
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
