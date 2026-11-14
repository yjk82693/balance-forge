import { HEROES, heroName } from "../lib/heroes";
import type { Matchup } from "../lib/matchup";

interface Props {
  value: Matchup;
  onChange: (m: Matchup) => void;
  disabled?: boolean;
  title?: string;
}

/** Two hero selects. The same hero cannot be on both sides: picking it on one side moves the other to a free hero. */
export function MatchupPicker({ value, onChange, disabled, title }: Props) {
  const set = (side: 0 | 1, hero: string) => {
    const other = value[1 - side];
    const next: Matchup = [...value];
    next[side] = hero;
    if (hero === other) next[1 - side] = HEROES.find((h) => h.id !== hero && h.id !== value[side])?.id ?? value[side];
    onChange(next);
  };
  return (
    <div className="matchup" role="group" aria-label="Matchup to measure" title={title}>
      {([0, 1] as const).map((side) => (
        <label key={side} className="matchup-side small">
          <span className="sr-only">{side === 0 ? "First hero" : "Second hero"}</span>
          <select
            className="select"
            value={value[side]}
            disabled={disabled}
            onChange={(e) => set(side, e.target.value)}
          >
            {HEROES.map((h) => (
              <option key={h.id} value={h.id} disabled={h.id === value[1 - side]}>
                {heroName(h.id)}
              </option>
            ))}
          </select>
          {side === 0 && <span aria-hidden="true"> vs </span>}
        </label>
      ))}
    </div>
  );
}
