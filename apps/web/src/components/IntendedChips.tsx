import { useState } from "react";
import type { PlaytestRun } from "../lib/api";
import { heroName } from "../lib/heroes";
import { getIntent, saveIntent, setIntent, pairKey } from "../lib/intent";
import { choicesFor, reanalyze, withChoice } from "../lib/reanalyze";
import { isMockMode } from "../mock/types";

interface Props {
  /** the flagged matchup, in the order the report names it */
  a: string;
  b: string;
  run: PlaytestRun | null;
  /** the run judged again against the new intent; the screen swaps it in place */
  onRun: (run: PlaytestRun) => void;
  /** large chips for the presenter */
  big?: boolean;
}

/** "Intended?": one tap saves the designer's intent for this pair, then the same games are judged again. */
export function IntendedChips({ a, b, run, onRun, big }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const mock = isMockMode();
  const choices = choicesFor(a, b);
  const now = getIntent().matchups[pairKey(a, b)] ?? { strength: "even" as const };
  const current = choices.find((c) => c.value.favored === now.favored && c.value.strength === now.strength);

  const pick = async (id: string) => {
    const choice = choices.find((c) => c.id === id);
    if (!choice || working) return;
    const next = withChoice(getIntent(), a, b, choice.value);
    setNote(null);
    if (mock) {
      setIntent(next);
      return setNote("Sample data: kept on this screen only.");
    }
    setWorking(true);
    try {
      setIntent(await saveIntent(next));
      if (!run?.runId) return setNote("Intent saved. Re-run to apply.");
      const result = await reanalyze(run.runId);
      if (result.kind === "ok") {
        onRun(result.run);
        setNote("Judged again against the new intent.");
      } else if (result.kind === "absent") {
        setNote("Intent saved. Re-run to apply.");
      } else {
        setNote(`Intent saved, but the numbers did not update: ${result.message}`);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save the intent.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className={`intent-chips${big ? " big" : ""}`}
      role="group"
      aria-label={`Intended result, ${heroName(a)} vs ${heroName(b)}`}
    >
      <span className="intent-chips-q">Intended?</span>
      {choices.map((c) => (
        <button
          key={c.id}
          className={`intent-chip${c.id === current?.id ? " on" : ""}`}
          aria-pressed={c.id === current?.id}
          disabled={working}
          onClick={() => void pick(c.id)}
          title={c.id === "even" ? "Even" : `${c.label}: ${c.id.startsWith("A") ? heroName(a) : heroName(b)}`}
        >
          {big ? c.label.replace(/^[AB]\b/, (side) => heroName(side === "A" ? a : b)) : c.label}
        </button>
      ))}
      {note && (
        <span className="intent-chips-note" role="status">
          {note}
        </span>
      )}
    </div>
  );
}
