import type { MatchResult } from "../lib/contract";
import { heroName } from "../lib/heroes";
import { HeroPortrait } from "./HeroPortrait";

export interface MatchRow {
  result: MatchResult;
  human: boolean;
  /** hero per seat when known (human rows come from the lobby; bot rows carry none) */
  heroes: Record<string, string>;
  names: Record<string, string>;
  /** the match the viewer just played on their phone */
  justPlayed?: boolean;
}

const fmtTime = (ticks: number) => {
  const s = Math.round(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const seatLabel = (row: MatchRow, seat: string) => row.names[seat] ?? "bot";

function winnerLabel(r: MatchRow, winSeat: string): string {
  const m = r.result;
  if (m.outcome.status === "draw") return "Draw";
  if (!m.valid) return "—";
  return r.heroes[winSeat] ? heroName(r.heroes[winSeat]) : seatLabel(r, winSeat);
}

function rowClass(r: MatchRow, selected: boolean): string {
  return [selected && "selected", !r.result.valid && "invalid", r.justPlayed && "just"].filter(Boolean).join(" ");
}

interface Props {
  rows: MatchRow[];
  selected: string;
  onSelect: (matchId: string) => void;
  compact?: boolean;
}

export function MatchesTable({ rows, selected, onSelect, compact }: Props) {
  // Human matches pin to the top.
  const ordered = [...rows].sort((a, b) => Number(b.human) - Number(a.human));
  return (
    <table className={`matches${compact ? " compact" : ""}`}>
      <thead>
        <tr>
          <th>Match</th>
          <th>Players</th>
          <th>Winner</th>
          <th className="num">Time</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody aria-live="polite">
        {ordered.map((r) => {
          const { result: m } = r;
          const [p1, p2] = m.config.players;
          const win = m.outcome.winners[0];
          const winner = winnerLabel(r, win);
          return (
            <tr
              key={m.matchId}
              className={rowClass(r, selected === m.matchId)}
              tabIndex={0}
              aria-selected={selected === m.matchId}
              onClick={() => onSelect(m.matchId)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(m.matchId))}
            >
              <td className="num-left">{m.matchId.replace(/^m-0*/, "#")}</td>
              <td>
                <span className="players">
                  {r.human && <HeroPortrait hero={r.heroes[p1]} size={32} />}
                  {seatLabel(r, p1)} <span className="text-2">v</span> {seatLabel(r, p2)}
                </span>
              </td>
              <td>{winner}</td>
              <td className="num">{fmtTime(m.statistics.durationTicks)}</td>
              <td>
                <span className="badges">
                  {r.human ? <span className="badge human">human</span> : <span className="badge">bot</span>}
                  {r.justPlayed && <span className="badge after">you just played this</span>}
                  {m.valid ? (
                    <span className="badge recorded">recorded</span>
                  ) : (
                    <span className="status bad">
                      <span className="dot" />
                      invalid · {m.errorCode.toLowerCase().replace(/_/g, " ")}
                    </span>
                  )}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
