import { VersionRow } from "./VersionRow";
import { branchChip, layoutBlocks, shortHash, type VersionRecord } from "../lib/versions";

interface Props {
  versions: VersionRecord[];
  currentHash?: string;
  /** a selected version and a way to pick one; leave both out for a read-only list (the presenter) */
  selected?: string | null;
  onPick?: (hash: string) => void;
}

/** The history, newest first. Siblings of one parent sit side by side under a heading, each with how it fared. */
export function VersionHistory({ versions, currentHash, selected, onPick }: Props) {
  return (
    <ul className="version-list">
      {layoutBlocks(versions).map((b) =>
        b.kind === "row" ? (
          <VersionRow
            key={b.row.record.dataHash}
            row={b.row}
            selected={b.row.record.dataHash === selected}
            current={b.row.record.dataHash === currentHash}
            onPick={onPick && (() => onPick(b.row.record.dataHash))}
          />
        ) : (
          <li key={`group-${b.parent}`} className="sibling-group">
            <p className="caption">Candidates from {shortHash(b.parent)}</p>
            <ul className="sibling-grid">
              {b.rows.map((r) => (
                <VersionRow
                  key={r.record.dataHash}
                  row={{ ...r, lane: 0 }}
                  selected={r.record.dataHash === selected}
                  current={r.record.dataHash === currentHash}
                  chip={branchChip(r.record)}
                  onPick={onPick && (() => onPick(r.record.dataHash))}
                />
              ))}
            </ul>
          </li>
        ),
      )}
    </ul>
  );
}
