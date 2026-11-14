import type { Proposal } from "../lib/api";
import { originHint, originLabel } from "../lib/fullRun";
import { rangeNote } from "../lib/statPaths";
import { describePath } from "./PatchCompare";

/** The patch in one card: what changed (field, old -> new), why (the model's rationale), and where it came from. */
export function DiffCard({ proposal, sample }: { proposal: Proposal; sample?: boolean }) {
  const changes =
    proposal.changes ??
    proposal.patch.replacements.map((r) => ({
      path: r.path,
      label: undefined,
      old: undefined as number | undefined,
      new: r.value,
    }));
  return (
    <section className="panel diff" aria-labelledby="diff-title">
      <div className="panel-head">
        <span id="diff-title" className="eyebrow">
          Suggested patch
        </span>
        <span className="badge origin" title={originHint(proposal.origin)}>
          {originLabel(proposal.origin)}
        </span>
        {sample && <span className="badge">sample</span>}
        <span className="meta">
          {proposal.validation.ok ? (
            <span className="status ok">
              <span className="dot" />
              valid
            </span>
          ) : (
            <span className="status bad">
              <span className="dot" />
              failed validation
            </span>
          )}
        </span>
      </div>
      <div className="diff-body">
        <ul className="diff-list">
          {changes.slice(0, 3).map((c) => (
            <li key={c.path}>
              <span className="small diff-field">
                {c.label ?? describePath(c.path)}
                {rangeNote(c.path) && <span className="caption"> · {rangeNote(c.path)}</span>}
              </span>
              <span className="diff-vals">
                <span className="old">{c.old ?? "—"}</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> changes to </span>
                <span className="new">{c.new}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="diff-why">{proposal.patch.rationale}</p>
      </div>
      {proposal.validation.errors.slice(0, 2).map((e) => (
        <p key={e} className="caption" style={{ color: "var(--danger)" }}>
          {e}
        </p>
      ))}
    </section>
  );
}
