import { useEffect, useRef } from "react";
import type { Transport } from "../mock/types";

/** `?debug=1` in the page address turns the on-screen network readout on. */
export const isDebug = () => new URLSearchParams(location.search).get("debug") === "1";

const PING_EVERY_MS = 1000;
const SMOOTH = 0.3; // weight of the newest sample in the averages

export interface NetReadout {
  /** ping to pong, ms */
  rtt?: number;
  /** input.submit sent to input.ack received, ms (phone only) */
  inputToAck?: number;
}

/**
 * Round-trip and input-to-ack times for the debug readout. One ping at a time (the pong echoes no id the web can
 * match, and one per second is enough); acks are matched by the input's seq, which the server copies onto the ack.
 */
export class NetStats {
  readonly readout: NetReadout = {};
  private pingAt: number | undefined;
  private sentAt = new Map<number, number>();

  private blend(old: number | undefined, sample: number) {
    return old === undefined ? sample : old + (sample - old) * SMOOTH;
  }

  pingSent(now: number) {
    this.pingAt = now;
  }
  pong(now: number) {
    if (this.pingAt === undefined) return;
    this.readout.rtt = this.blend(this.readout.rtt, now - this.pingAt);
    this.pingAt = undefined;
  }
  inputSent(seq: number, now: number) {
    this.sentAt.set(seq, now);
    if (this.sentAt.size > 200) this.sentAt.delete(this.sentAt.keys().next().value as number);
  }
  inputAck(seq: number, now: number) {
    const at = this.sentAt.get(seq);
    if (at === undefined) return;
    this.sentAt.delete(seq);
    this.readout.inputToAck = this.blend(this.readout.inputToAck, now - at);
  }
}

/** Pings the server once a second and listens for pongs and acks; null (and no traffic) unless ?debug=1. */
export function useNetStats(transport: Transport | null): NetStats | null {
  const stats = useRef<NetStats | null>(null);
  const on = isDebug() && !!transport;
  if (on && !stats.current) stats.current = new NetStats();
  useEffect(() => {
    const s = stats.current;
    if (!on || !s || !transport) return;
    const off = transport.subscribe((env) => {
      if (env.type === "pong") s.pong(performance.now());
      else if (env.type === "input.ack") s.inputAck(env.seq, performance.now());
    });
    const timer = setInterval(() => {
      s.pingSent(performance.now());
      transport.send("ping", {});
    }, PING_EVERY_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [on, transport]);
  return on ? stats.current : null;
}
