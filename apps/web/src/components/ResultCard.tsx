import { useState, type ReactNode } from "react";
import { pct } from "../lib/stats";
import { n } from "../lib/dashboardData";
import { VERDICT_COPY } from "../lib/dashboardData";
import { summaryText, type Rate, type ResultFacts } from "../lib/resultCard";

const rateLine = (r: Rate) => (
  <>
    <strong>{pct(r.rate)}%</strong>
    <span className="caption">
      {" "}
      95% CI {pct(r.lo)}–{pct(r.hi)}% · {n(r.games)} games
    </span>
  </>
);

/** Copies text; falls back to a hidden textarea where the clipboard API is blocked. Returns whether it worked. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      box.remove();
    }
  }
}

function CopyButton({ facts }: { facts: ResultFacts }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    setState((await copyText(summaryText(facts))) ? "done" : "failed");
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <button className="btn secondary" onClick={copy} aria-live="polite">
      {state === "done" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy summary"}
    </button>
  );
}

/** The finished run in one card: outlier, patch, holdout and verdict, then other findings from the recorded roster. */
interface CardProps {
  facts: ResultFacts;
  title?: string;
  /** extra lines under the header, e.g. what a version was compared with */
  children?: ReactNode;
}

export function ResultCard({ facts, title = "Result", children }: CardProps) {
  const { outlier, patch, holdout, verdict, others, othersNote } = facts;
  return (
    <section className="panel result" aria-labelledby="result-title">
      <div className="panel-head">
        <span id="result-title" className="eyebrow">
          {title}
        </span>
        <span className={`badge${facts.source === "live run" ? "" : " recorded"}`}>
          {facts.source}
          {facts.sourceDetail ? ` · ${facts.sourceDetail}` : ""}
        </span>
        <span className="spacer" />
        <CopyButton facts={facts} />
      </div>
      {children}
      <div className="result-grid">
        <div>
          <p className="caption">{outlier?.isOutlier ? "Outlier" : "Most lopsided matchup"}</p>
          {outlier ? (
            <p className="result-line">
              {outlier.matchup} · {rateLine(outlier)}
            </p>
          ) : (
            <p className="small text-2">Too few games per matchup to name one.</p>
          )}
        </div>
        <div>
          <p className="caption">AI patch</p>
          {patch.length === 0 && <p className="small text-2">This run has no patch.</p>}
          {patch.map((p) => (
            <p key={p.field} className="result-line">
              {p.field} <span className="old">{p.old ?? "—"}</span> → <span className="new">{p.next}</span>{" "}
              <span className="badge origin">{p.origin}</span>{" "}
              {p.valid !== undefined && (
                <span className={`status ${p.valid ? "ok" : "bad"}`}>
                  <span className="dot" />
                  {p.valid ? "valid" : "failed validation"}
                </span>
              )}
            </p>
          ))}
          {patch[0]?.rationale && <p className="caption result-why">{patch[0].rationale}</p>}
        </div>
        <div>
          <p className="caption">Holdout on the patched data</p>
          {holdout ? (
            <p className="result-line">{rateLine(holdout)}</p>
          ) : (
            <p className="small text-2">No holdout run in this data.</p>
          )}
          {verdict && (
            <p className="result-line">
              <span className={`status ${VERDICT_COPY[verdict.kind].cls}`}>
                <span className="dot" />
                {verdict.label}
              </span>
              {verdict.reasons[0] && <span className="caption"> {verdict.reasons[0]}</span>}
            </p>
          )}
        </div>
        {others && (
          <div>
            <p className="caption">
              Other findings <span className="badge recorded">recorded</span>
            </p>
            {others.map((o) => (
              <p key={o.matchup} className="result-line">
                {o.matchup} · {o.side} {rateLine(o)}
              </p>
            ))}
            {others.length === 0 && <p className="small text-2">{othersNote ?? "No recorded roster report."}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
