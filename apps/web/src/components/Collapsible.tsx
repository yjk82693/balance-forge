import { useId, useState, type ReactNode } from "react";

interface SectionProps {
  title: string;
  /** a short count or note beside the title, e.g. "3 targets" */
  note?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A section that opens and closes; closed sections cost one line. */
export function Collapsible({ title, note, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`collapsible${open ? " open" : ""}`}>
      <button className="collapsible-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="collapsible-title">{title}</span>
        {note && <span className="collapsible-note">{note}</span>}
        <span className="collapsible-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div id={id} className="collapsible-body">
          {children}
        </div>
      )}
    </section>
  );
}

export interface TabDef {
  id: string;
  title: string;
  note?: string;
  body: ReactNode;
}

/** One panel open at a time, chosen from a row of tabs. */
export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [current, setCurrent] = useState(initial ?? tabs[0]?.id);
  const open = tabs.find((t) => t.id === current) ?? tabs[0];
  return (
    <div className="tabs">
      <div className="tablist" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === open?.id}
            className={`tab${t.id === open?.id ? " on" : ""}`}
            onClick={() => setCurrent(t.id)}
          >
            {t.title}
            {t.note && <span className="tab-note">{t.note}</span>}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel">
        {open?.body}
      </div>
    </div>
  );
}
