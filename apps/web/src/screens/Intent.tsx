import { useState } from "react";
import { FitStage } from "../components/FitStage";
import { IntentGrid } from "../components/IntentGrid";
import { TopBar } from "../components/TopBar";
import { useManifest } from "../lib/assets";
import { cycle, getIntent, hasIntent, saveIntent, setIntent, useIntent } from "../lib/intent";
import { isMockMode } from "../mock/types";

/** The designer's chart: click a cell to cycle even, then each hero's slight, clear and strong favor. */
export function Intent() {
  useManifest();
  const mock = isMockMode();
  const intent = useIntent();
  const [saved, setSaved] = useState(getIntent());
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const changed = JSON.stringify(intent.matchups) !== JSON.stringify(saved.matchups);

  const save = async () => {
    setState("saving");
    try {
      const next = await saveIntent(intent);
      setIntent(next);
      setSaved(next);
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setState("error");
    }
  };

  return (
    <FitStage>
      <div className="screen">
        <TopBar>
          <a className="link-back" href="#/dashboard">
            ← Dashboard
          </a>
          <span className="eyebrow" style={{ color: "var(--game-arena)" }}>
            HERO ARENA
          </span>
          <span className="small text-2">Design intent</span>
          <span className="spacer" />
          <button
            className="btn primary"
            aria-disabled={mock || !changed || state === "saving"}
            onClick={() => !mock && changed && state !== "saving" && save()}
          >
            {state === "saving" ? "Saving…" : "Save intent"}
          </button>
        </TopBar>
        <main className="intent-main">
          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">What the designer wants</span>
              {mock && <span className="badge">sample data</span>}
            </div>
            <IntentGrid intent={intent} onCycle={(a, b) => setIntent(cycle(getIntent(), a, b))} />
            {!hasIntent(intent) && (
              <p className="caption">Every matchup is intended to be even. Click a cell to favor a hero.</p>
            )}
            {mock && <p className="caption">Sample data: changes stay on this page and are not saved.</p>}
            {state === "saved" && (
              <p className="small" role="status">
                Saved. Every win-rate view now uses this intent.
              </p>
            )}
            {state === "error" && (
              <p className="err small" role="alert">
                {error}
              </p>
            )}
          </section>
        </main>
      </div>
    </FitStage>
  );
}
