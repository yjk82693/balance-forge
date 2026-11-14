import { useEffect, useState } from "react";
import { isMockMode } from "../mock/types";

export interface TrendPoint {
  dataHash: string;
  firstSeen: string;
  games: number;
  rate: number;
}

/**
 * GET /v1/trend/hero_arena?matchup=a vs b: one point per data version (Tiger Data time series). Null when the server
 * has no series (404 when the store is off, 400 for a bad matchup) or on any failure; the chart is then hidden.
 */
export async function loadTrend(matchup: string, signal?: AbortSignal): Promise<TrendPoint[] | null> {
  try {
    const res = await fetch(`/v1/trend/hero_arena?matchup=${encodeURIComponent(matchup)}`, { signal });
    if (!res.ok) return null;
    const raw = (await res.json()) as { points?: unknown };
    if (!Array.isArray(raw.points)) return null;
    const points = raw.points.flatMap((p: Record<string, unknown>) =>
      p && typeof p.data_hash === "string" && Number.isFinite(p.rate) && Number.isFinite(p.games)
        ? [
            {
              dataHash: p.data_hash,
              firstSeen: String(p.first_seen ?? ""),
              games: Number(p.games),
              rate: Number(p.rate),
            },
          ]
        : [],
    );
    return points.length ? points : null;
  } catch {
    return null;
  }
}

export function useTrend(matchup: string | null): TrendPoint[] | null {
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  useEffect(() => {
    setPoints(null);
    if (isMockMode() || !matchup) return;
    const c = new AbortController();
    loadTrend(matchup, c.signal).then(setPoints);
    return () => c.abort();
  }, [matchup]);
  return points;
}
