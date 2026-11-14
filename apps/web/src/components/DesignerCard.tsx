import type { DesignerCase } from "../lib/designer";
import { heroName } from "../lib/heroes";
import { describePath } from "./PatchCompare";
import { HeroPortrait } from "./HeroPortrait";

/** A hero the auto-balance gave up on: the levers it tried with their outcomes, and the hand-over line. */
export function DesignerCard({ c }: { c: DesignerCase }) {
  return (
    <article className="designer-card">
      <header className="profile-head">
        <HeroPortrait hero={c.hero} size={28} />
        <span className="small profile-name">{heroName(c.hero)}</span>
        <span className="badge before">handed to a designer</span>
      </header>
      {c.tried.length > 0 && (
        <ul className="tried-list" aria-label="Levers tried">
          {c.tried.map((t, i) => (
            <li key={`${t.path}-${i}`} className="small">
              {t.label === t.path ? describePath(t.path) : t.label}
              {t.old !== undefined && t.new !== undefined && (
                <>
                  {" "}
                  <span className="old">{t.old}</span> → <span className="new">{t.new}</span>
                </>
              )}{" "}
              <span className="badge">{t.outcome || "no outcome"}</span>
            </li>
          ))}
        </ul>
      )}
      {c.evidence && <p className="caption">{c.evidence}</p>}
      <p className="small">Numbers alone did not fix this; a designer should look.</p>
    </article>
  );
}

/** The "Handed to a designer" section; nothing at all when there are no cases. */
export function DesignerSection({ cases }: { cases: DesignerCase[] }) {
  if (!cases.length) return null;
  return (
    <section className="designer-section" aria-label="Handed to a designer">
      <p className="caption">Handed to a designer</p>
      <div className="profile-grid">
        {cases.map((c) => (
          <DesignerCard key={c.hero} c={c} />
        ))}
      </div>
    </section>
  );
}
