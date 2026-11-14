import { useEffect, useState } from "react";
import { isMockMode } from "../mock/types";

export interface SinkStatus {
  written: number;
  failed: number;
}
export interface Sinks {
  enabled: string[];
  status: Record<string, SinkStatus>;
}

const NAMES: Record<string, string> = { mongodb: "MongoDB Atlas", tiger: "Tiger Data" };
export const sinkName = (id: string) => NAMES[id] ?? id;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** GET /v1/sinks: which stores the server writes to. Null on any failure: the chip is then simply not shown. */
export async function loadSinks(signal?: AbortSignal): Promise<Sinks | null> {
  try {
    const res = await fetch("/v1/sinks", { signal });
    if (!res.ok) return null;
    const raw = (await res.json()) as { enabled?: unknown; status?: Record<string, Record<string, unknown>> };
    const enabled = Array.isArray(raw.enabled) ? raw.enabled.filter((x): x is string => typeof x === "string") : [];
    const status: Sinks["status"] = {};
    for (const id of enabled) {
      const s = raw.status?.[id];
      status[id] = { written: num(s?.written), failed: num(s?.failed) };
    }
    return { enabled, status };
  } catch {
    return null;
  }
}

/** The sinks once, when the screen mounts (never in `?mock=1`). */
export function useSinks(): Sinks | null {
  const [sinks, setSinks] = useState<Sinks | null>(null);
  useEffect(() => {
    if (isMockMode()) return;
    const c = new AbortController();
    loadSinks(c.signal).then(setSinks);
    return () => c.abort();
  }, []);
  return sinks;
}
