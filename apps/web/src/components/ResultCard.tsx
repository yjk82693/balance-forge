import { useState, type ReactNode } from "react";
import { pct } from "../lib/stats";
import { VERDICT_COPY, n } from "../lib/dashboardData";
import type { VerdictTarget } from "../lib/api";
import { matchupName as matchupLabel } from "../lib/versions";
import { HeroProfile } from "./HeroProfile";
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
function PatchColumn({ patch }: { patch: ResultFacts["patch"] }) {
  return (
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
  );
}

const OUTCOME_CHIP: Record<VerdictTarget["outcome"], { cls: string; label: string }> = {
  improved: { cls: "status ok", label: "improved" },
  unchanged: { cls: "badge", label: "unchanged" },
  worse: { cls: "status bad", label: "worse" },
};

const place = (rate: number) => `${Math.max(0, Math.min(100, rate * 100))}%`;

/** A small bar from 0 to 100%: the 45-55% band, the rate before (hollow) and after (filled) joined by a line. */
function BeforeAfterBar({ target }: { target: VerdictTarget }) {
  const lo = Math.min(target.before.rate, target.after.rate);
  const hi = Math.max(target.before.rate, target.after.rate);
  return (
    <span
      className="ba-bar"
      role="img"
      aria-label={`${pct(target.before.rate)}% before, ${pct(target.after.rate)}% after`}
    >
      <span className="ba-band" />
      <span className="ba-line" style={{ left: place(lo), width: `${(hi - lo) * 100}%` }} />
      <span className="ba-dot before" style={{ left: place(target.before.rate) }} />
      <span className="ba-dot after" style={{ left: place(target.after.rate) }} />
    </span>
  );
}

/** One row per target: the matchup, the small before to after bar, the numbers and an outcome chip. */
function TargetRows({ targets }: { targets: VerdictTarget[] }) {
  return (
    <ul className="target-rows" aria-label="Targets, before and after the patch">
      {targets.map((t) => (
        <li key={t.matchup} className="target-row">
          <span className="small">{matchupLabel(t.matchup)}</span>
          <BeforeAfterBar target={t} />
          <span className="caption">
            {pct(t.before.rate)}% → {pct(t.after.rate)}%
          </span>
          <span className={OUTCOME_CHIP[t.outcome].cls}>{OUTCOME_CHIP[t.outcome].label}</span>
        </li>
      ))}
    </ul>
  );
}

function HoldoutColumn({ holdout, verdict }: Pick<ResultFacts, "holdout" | "verdict">) {
  return (
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
  );
}

interface CardProps {
  facts: ResultFacts;
  title?: string;
  /** extra lines under the header, e.g. what a version was compared with */
  children?: ReactNode;
}

export function ResultCard({ facts, title = "Result", children }: CardProps) {
  const { fair, outlier, evidence, patch, holdout, verdict, others, othersNote } = facts;
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
          {fair && (
            <p className="result-line">
              <span className="status ok">
                <span className="dot" />
                Fair: no patch needed
              </span>
            </p>
          )}
          <p className="caption">{fair ? "Matchup" : outlier?.isOutlier ? "Outlier" : "Most lopsided matchup"}</p>
          {outlier ? (
            <p className="result-line">
              {outlier.matchup} · {rateLine(outlier)}
            </p>
          ) : (
            <p className="small text-2">Too few games per matchup to name one.</p>
          )}
          {evidence && <p className="caption result-why">{evidence}</p>}
        </div>
        {!fair && <PatchColumn patch={patch} />}
        {!fair && <HoldoutColumn holdout={holdout} verdict={verdict} />}
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
      {!fair && verdict && verdict.targets.length > 0 && <TargetRows targets={verdict.targets} />}
      {facts.diagnosis && <HeroProfile diagnosis={facts.diagnosis} patchPaths={facts.patchPaths} />}
    </section>
  );
}
