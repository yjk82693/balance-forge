import type { PlaytestRun } from "../lib/api";
import { fmtSeconds, n } from "../lib/dashboardData";
import { heroName } from "../lib/heroes";
import type { JustPlayed } from "../lib/justPlayed";

function winnerText(played: JustPlayed): string {
  const { outcome } = played.result;
  if (outcome.status === "draw") return "draw";
  const seat = outcome.winners[0];
  const hero = played.heroes[seat];
  return `${hero ? heroName(hero) : (played.names[seat] ?? "winner")} won`;
}

const matchSeconds = (played: JustPlayed) => Math.round((played.result.statistics.durationTicks / 60) * 1000);

interface Props {
  run: PlaytestRun | null;
  played: JustPlayed | null;
}

/** Real-mode matches table: the human row sits right above the bot row so they read together. */
export function RunTable({ run, played }: Props) {
  const humans = Math.max(run?.baseline.humanMatches ?? 0, played ? 1 : 0);
  const waiting = run ? "None yet" : "Waiting for a run";
  const baseline = run?.baseline;
  return (
    <table className="matches compact">
      <thead>
        <tr>
          <th>Group</th>
          <th>Details</th>
          <th className="num">Matches</th>
          <th className="num">Time</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody aria-live="polite">
        <tr className={played ? "just" : undefined}>
          <td>
            <span className="players">
              <span className="badge human">human</span>
              {played && <span className="badge after">you just played this</span>}
            </span>
          </td>
          <td>
            {played ? (
              `${played.names.p1 ?? "p1"} v ${played.names.p2 ?? "p2"} · ${winnerText(played)}`
            ) : (
              <span className="caption">{waiting}</span>
            )}
          </td>
          <td className="num">{run || played ? n(humans) : "—"}</td>
          <td className="num">{played ? fmtSeconds(matchSeconds(played)) : "—"}</td>
          <td>
            {played?.result.valid ? (
              <span className="badge recorded">recorded</span>
            ) : (
              <span className="caption">—</span>
            )}
          </td>
        </tr>
        <tr>
          <td>
            <span className="players">
              <span className="badge">bot</span>
            </span>
          </td>
          <td>Bot v bot</td>
          <td className="num">{baseline ? n(baseline.validMatches) : "—"}</td>
          <td className="num">{baseline?.elapsedMs != null ? fmtSeconds(baseline.elapsedMs) : "—"}</td>
          <td>
            {baseline?.recorded ? (
              <span className="badge recorded">recorded</span>
            ) : (
              <span className="caption">{run ? "Live run" : "Waiting for a run"}</span>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
