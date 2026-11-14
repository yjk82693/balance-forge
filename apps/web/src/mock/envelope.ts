import type { Envelope } from "../lib/contract";

export function makeEnvelope<P>(
  type: string,
  payload: P,
  meta: Partial<Omit<Envelope<P>, "payload" | "type" | "protocolVersion">> = {},
): Envelope<P> {
  return {
    protocolVersion: "0.1",
    type,
    roomId: meta.roomId ?? "ROOM42",
    sessionId: meta.sessionId ?? "",
    requestId: meta.requestId ?? "",
    seq: meta.seq ?? 0,
    epoch: meta.epoch ?? 1,
    payload,
  };
}
