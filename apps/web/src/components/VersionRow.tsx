import { VERDICT_COPY } from "../lib/dashboardData";
import { originLabel } from "../lib/fullRun";
import { pct } from "../lib/stats";
import { fieldText, matchupName, shortHash, type Row } from "../lib/versions";

interface RowProps {
  row: Row;
  selected?: boolean;
  current: boolean;
  /** how this version fared against its siblings (chosen, accepted but not chosen, rejected) */
  chip?: { label: string; cls: string } | null;
  /** leave out for a read-only row (the presenter): it is then plain content, not a button */
  onPick?: () => void;
}

/** One version in the history: hash, origin, the changed fields, the target matchup before → after and the verdict. */
export function VersionRow({ row, selected = false, current, chip, onPick }: RowProps) {
  const { record: v } = row;
  const t = v.target;
  const verdict = v.verdict ? VERDICT_COPY[v.verdict.verdict] : null;
  const content = (
    <>
      <span className="version-hash">{shortHash(v.dataHash)}</span>
      <span className="badge origin">{v.origin === "base" ? "base" : originLabel(v.origin)}</span>
      {current && <span className="badge after">current</span>}
      {chip && <span className={`status ${chip.cls}`}>{chip.label}</span>}
      {!v.approved && <span className="badge before">candidate versions — not shipped</span>}
      {v.note && <span className="caption">{v.note}</span>}
      <span className="version-fields small">
        {v.changes.length ? v.changes.slice(0, 2).map(fieldText).join(" · ") : "The shipped data"}
      </span>
      {t && (
        <span className="small">
          {matchupName(t.matchup)} {pct(t.before.rate)}% → {pct(t.after.rate)}%
        </span>
      )}
      {v.verdict && verdict && (
        <span className={`status ${verdict.cls}`}>
          <span className="dot" />
          {verdict.glyph}
          {verdict.label}
        </span>
      )}
    </>
  );
  return (
    <li style={{ marginLeft: row.lane * 24 }}>
      {onPick ? (
        <button className={`version-row${selected ? " on" : ""}`} onClick={onPick} aria-pressed={selected}>
          {content}
        </button>
      ) : (
        <div className="version-row">{content}</div>
      )}
    </li>
  );
}
