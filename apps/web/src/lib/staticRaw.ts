// The recorded Bari vs Real Armor result of the static demo, put together from two committed files of the live system:
// the recorded roster report (baseline) and the recorded auto-balance history (the newest accepted patch for that
// matchup, with its measured before/after and verdict). Nothing is invented: every number is in those files.
// The result has the shape of POST /v1/playtest/full, so the normal parser reads it.

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object";

/**
 * The recorded patch the demo shows: an accepted, non-root version with a measured target, the one the auto-balance
 * approved first (then the newest accepted). Null when the history has none.
 */
export function pickRecordedVersion(versions: unknown[]): Obj | null {
  const ok = versions.filter(
    (v): v is Obj =>
      obj(v) &&
      v.origin !== "base" &&
      obj(v.target) &&
      typeof v.target.matchup === "string" &&
      obj(v.verdict) &&
      v.verdict.verdict === "accepted",
  );
  ok.sort(
    (a, b) => Number(b.approved === true) - Number(a.approved === true) ||
      (String(a.createdAt) < String(b.createdAt) ? 1 : -1),
  );
  return ok[0] ?? null;
}

const wilsonOutside = (ci: unknown) =>
  Array.isArray(ci) && (Number(ci[0]) > 0.55 || Number(ci[1]) < 0.45);

/**
 * A /full-shaped body: the roster report as the baseline, the version's patch, a patched report that differs from the
 * baseline in the target row only (its recorded "after"), and the recorded verdict. Without a version: baseline only.
 */
export function staticRaw(roster: Obj, history: Obj): Obj {
  const version = pickRecordedVersion(Array.isArray(history.versions) ? history.versions : []);
  const all = Array.isArray(roster.rows) ? (roster.rows as Obj[]) : [];
  const matchup = version ? String((version.target as Obj).matchup) : "";
  // Like the live run, the result is about one matchup; the whole roster is shown separately, from the same report.
  const rows = version ? all.filter((r) => r.dimension === matchup) : all;
  const only = (list: Obj[]): Obj => ({
    ...roster,
    elapsedMs: undefined, // the roster's time is for its 3,000 matches, not for this matchup's 200
    rows: list,
    validMatches: list.reduce((n, r) => n + Number(r.games), 0),
  });
  const out: Obj = { gameId: roster.gameId, baseline: only(rows), fair: false };
  if (!version) return out;
  const target = version.target as Obj;
  const after = target.after as Obj;
  const games = Number(after.games);
  const rate = Number(after.rate);
  const patchedRows = rows.map((r) =>
    r.dimension === matchup
      ? {
          ...r,
          wins: Math.round(rate * games),
          games,
          winRate: rate,
          ci95: after.ci95,
          outlier: wilsonOutside(after.ci95),
        }
      : r,
  );
  const changes = Array.isArray(version.changes) ? (version.changes as Obj[]) : [];
  return {
    ...out,
    patched: { ...only(patchedRows), reportId: `${String(roster.reportId)}-patched` },
    patchedDataHash: version.dataHash,
    proposal: {
      baseDataHash: String(roster.dataHash ?? ""),
      rationale: String(version.rationale ?? ""),
      replacements: changes.map((c) => ({ path: c.path, value: c.new })),
      origin: version.origin,
      changes,
    },
    validation: { ok: true, errors: [] },
    verdict: version.verdict,
  };
}
