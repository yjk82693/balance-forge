/** One lever the auto-balance tried for a hero, and how it turned out. */
export interface TriedLever {
  label: string;
  path: string;
  old?: number;
  new?: number;
  outcome: string;
}

/** A hero the numbers could not fix: nothing the auto-balance tried was accepted, so it moved on (`needs_designer`). */
export interface DesignerCase {
  hero: string;
  tried: TriedLever[];
  /** one line of evidence, when the server sent text */
  evidence?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function lever(raw: unknown): TriedLever | null {
  if (!isObject(raw) || typeof raw.path !== "string") return null;
  return {
    label: typeof raw.label === "string" ? raw.label : raw.path,
    path: raw.path,
    old: num(raw.old),
    new: num(raw.new),
    outcome: String(raw.outcome ?? ""),
  };
}

/** `needs_designer` (or `needsDesigner`): one entry per hero. Entries without a hero are dropped; absence gives []. */
export function parseDesigner(raw: unknown): DesignerCase[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) =>
    isObject(c) && typeof c.hero === "string"
      ? [{
          hero: c.hero,
          tried: (Array.isArray(c.tried) ? c.tried : []).flatMap((t) => lever(t) ?? []),
          evidence: typeof c.evidence === "string" ? c.evidence : undefined,
        }]
      : [],
  );
}

const KEY = "bf-needs-designer";

/** Remember the last auto-balance's hand-overs for this tab, so the presenter can show them too. */
export function saveDesigner(cases: DesignerCase[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cases));
  } catch {
    /* storage blocked: only the Versions screen shows them */
  }
}

export function loadDesigner(): DesignerCase[] {
  try {
    return parseDesigner(JSON.parse(sessionStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}
