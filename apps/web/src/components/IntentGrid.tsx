import { HEROES, heroColorVar, heroName } from "../lib/heroes";
import { targetFor, type Intent } from "../lib/intent";
import { pct } from "../lib/stats";
import { HeroPortrait } from "./HeroPortrait";

interface Props {
  intent: Intent;
  /** called with (row hero, column hero) when a cell is clicked; leave out for a read-only grid */
  onCycle?: (a: string, b: string) => void;
}

/** What a cell says: the target win rate of the row hero, and who is favored and by how much. */
function cellText(a: string, b: string, intent: Intent) {
  const t = targetFor(a, b, intent);
  const who = t.favored ? `${heroName(t.favored)} ${t.strength}` : "even";
  return { rate: `${pct(t.rate)}%`, who, favored: t.favored };
}

/** 5x5 hero grid without the diagonal. Each cell is the matchup of its row hero against its column hero. */
export function IntentGrid({ intent, onCycle }: Props) {
  return (
    <table className="intent-grid">
      <caption className="sr-only">
        Design intent: the win rate each row hero should have against each column hero
      </caption>
      <thead>
        <tr>
          <th scope="col" />
          {HEROES.map((h) => (
            <th key={h.id} scope="col" className="intent-head">
              <HeroPortrait hero={h.id} size={28} />
              <span className="caption">{h.name}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {HEROES.map((row) => (
          <tr key={row.id}>
            <th scope="row" className="intent-head side">
              <HeroPortrait hero={row.id} size={28} />
              <span className="caption">{row.name}</span>
            </th>
            {HEROES.map((col) => {
              if (col.id === row.id) return <td key={col.id} className="intent-cell diag" aria-hidden="true" />;
              const c = cellText(row.id, col.id, intent);
              const content = (
                <>
                  <strong>{c.rate}</strong>
                  <span className="caption">{c.who}</span>
                </>
              );
              return (
                <td key={col.id} className="intent-cell">
                  {onCycle ? (
                    <button
                      className={`intent-btn${c.favored ? " set" : ""}`}
                      style={c.favored ? { ["--hero" as string]: heroColorVar(c.favored) } : undefined}
                      onClick={() => onCycle(row.id, col.id)}
                      aria-label={`${row.name} against ${col.name}: ${c.rate}, ${c.who}. Click to change.`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      className={`intent-btn${c.favored ? " set" : ""}`}
                      style={c.favored ? { ["--hero" as string]: heroColorVar(c.favored) } : undefined}
                    >
                      {content}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={HEROES.length + 1} className="caption">
            Each cell: the row hero's target win rate against the column hero (even 50%, slight 55%, clear 60%, strong
            65% for the favored one). A result counts as fair within ±5 points of its target.
          </td>
        </tr>
      </tfoot>
    </table>
  );
}


