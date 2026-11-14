import { DECKS, type DeckPair } from "../lib/dashGame";
import { heroName } from "../lib/heroes";

interface Props {
  value: DeckPair;
  onChange: (m: DeckPair) => void;
  disabled?: boolean;
}

/** Two deck selects for Hero Cards. The same deck cannot be on both sides: picking it moves the other one. */
export function DeckPicker({ value, onChange, disabled }: Props) {
  const set = (side: 0 | 1, deck: string) => {
    const next: DeckPair = [...value];
    next[side] = deck;
    if (deck === value[1 - side]) next[1 - side] = DECKS.find((d) => d !== deck && d !== value[side]) ?? value[side];
    onChange(next);
  };
  return (
    <div className="matchup" role="group" aria-label="Decks to measure">
      {([0, 1] as const).map((side) => (
        <label key={side} className="matchup-side small">
          <span className="sr-only">{side === 0 ? "First deck" : "Second deck"}</span>
          <select
            className="select"
            value={value[side]}
            disabled={disabled}
            onChange={(e) => set(side, e.target.value)}
          >
            {DECKS.map((d) => (
              <option key={d} value={d} disabled={d === value[1 - side]}>
                {d === "standard" ? heroName(d) : `${heroName(d)} deck`}
              </option>
            ))}
          </select>
          {side === 0 && <span aria-hidden="true"> vs </span>}
        </label>
      ))}
    </div>
  );
}
