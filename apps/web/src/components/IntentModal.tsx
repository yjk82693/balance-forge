import { useEffect, useState } from "react";
import { IntentGrid } from "./IntentGrid";
import { cycle, getIntent, saveIntent, setIntent, useIntent } from "../lib/intent";
import { isMockMode } from "../mock/types";

/** The design intent chart in a dialog: click a cell to change it, Save sends it to the server. */
export function IntentModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const intent = useIntent();
  const mock = isMockMode();
  const [saved, setSaved] = useState(getIntent());
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const changed = JSON.stringify(intent.matchups) !== JSON.stringify(saved.matchups);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setState("saving");
    try {
      const next = await saveIntent(intent);
      setIntent(next);
      setSaved(next);
      setState("saved");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setState("error");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Design intent"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <span className="eyebrow">Design intent</span>
          {mock && <span className="badge">sample data</span>}
          <span className="spacer" />
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
          <button
            className="btn primary"
            aria-disabled={mock || !changed || state === "saving"}
            onClick={() => !mock && changed && state !== "saving" && save()}
          >
            {state === "saving" ? "Saving…" : "Save intent"}
          </button>
        </div>
        <IntentGrid intent={intent} onCycle={(a, b) => setIntent(cycle(getIntent(), a, b))} />
        {state === "saved" && <p role="status">Saved. Every win-rate view uses this intent.</p>}
        {state === "error" && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
