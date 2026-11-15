import { useEffect, useState } from "react";
import type { ReportRow } from "./contract.ts";
import { isHumanDimension } from "./groups.ts";

/** The human rows of GET /v1/humans/<gameId> ({ rows, humanMatches }): only "human: ..." rows are kept; else null. */
export function parseLiveHumans(body: unknown): ReportRow[] | null {
  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return null;
  const isRow = (r: unknown): r is ReportRow => !!r && typeof (r as ReportRow).dimension === "string";
  return rows.filter((r): r is ReportRow => isRow(r) && isHumanDimension(r.dimension));
}

/**
 * The human players' rows as they are now (the dashboard's report only has the snapshot taken at the last Run).
 * Fetched when the dashboard opens and when the game changes; null until it arrives or if the fetch fails, and the
 * caller then keeps the report's own human rows.
 */
export function useLiveHumans(gameId: string, enabled: boolean): ReportRow[] | null {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    if (!enabled) return;
    const ctl = new AbortController();
    fetch(`/v1/humans/${encodeURIComponent(gameId)}`, { signal: ctl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setRows(parseLiveHumans(body)))
      .catch(() => setRows(null));
    return () => ctl.abort();
  }, [gameId, enabled]);
  return rows;
}
