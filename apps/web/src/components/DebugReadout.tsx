import { useEffect, useState, type MutableRefObject } from "react";
import type { NetStats } from "../lib/netStats";
import type { BufferStats } from "../lib/snapshotBuffer";

interface Props {
  stats: NetStats | null;
  buffer?: MutableRefObject<BufferStats | null>;
}

/** Small readout in the corner of the page: ping, input-to-ack, and the interpolation buffer when it is passed in. */
export function DebugReadout({ stats, buffer }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  if (!stats) return null;
  const ms = (v?: number) => (v === undefined ? "—" : `${Math.round(v)} ms`);
  const b = buffer?.current;
  return (
    <div className="debug-readout" role="status">
      ping {ms(stats.readout.rtt)}
      {stats.readout.inputToAck !== undefined && ` · input→ack ${ms(stats.readout.inputToAck)}`}
      {b && ` · buffer ${b.depth} · delay ${b.renderDelayTicks} ticks · late ${b.late}`}
    </div>
  );
}
