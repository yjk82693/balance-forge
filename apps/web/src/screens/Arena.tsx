import { isArenaPayload, isCardsPayload, type CardsPayload, type Observation } from "../lib/contract";
import { go } from "../lib/router";
import { gameById } from "../lib/games";
import { heroName } from "../lib/heroes";
import { ArenaCanvas } from "../components/ArenaCanvas";
import { CardsCanvas } from "../components/CardsCanvas";
import { MockStatus, TopBar } from "../components/TopBar";
import { useTransport } from "../mock/transport";
import { useRoom } from "../mock/useRoom";

const fmtTime = (ticks: number) => {
  const s = Math.round(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Laptop main screen: the arena as the players see it. */
export function Arena({ gameId }: { gameId: string }) {
  const game = gameById(gameId);
  const { transport, status } = useTransport("display");
  const { room, observation, result } = useRoom(transport);
  const arenaObs = observation && isArenaPayload(observation.payload) ? (observation as Observation) : null;
  const cardsObs = observation && isCardsPayload(observation.payload) ? (observation as Observation<CardsPayload>) : null;
  const names = Object.fromEntries((room?.seats ?? []).map((s) => [s.seat, s.name || heroName(s.hero)]));
  const winnerSeat = result?.outcome.winners[0];
  const winner = room?.seats.find((s) => s.seat === winnerSeat);
  const winnerHero = (isArenaPayload(observation?.payload) ? observation.payload.entities.find((e) => e.id === winnerSeat)?.hero : undefined) ?? winner?.hero;

  return (
    <div className="screen" style={{ ["--game" as string]: `var(${game?.accentVar ?? "--game-arena"})` }}>
      <TopBar>
        <a className="link-back" href={`#/lobby/${gameId}`}>
          ← Lobby
        </a>
        <span className="eyebrow" style={{ color: "var(--game)" }}>
          {game?.eyebrow ?? "HERO ARENA"}
        </span>
        <span className="spacer" />
        <MockStatus online={status === "online"} />
      </TopBar>
      <main className="arena-screen">
        <div className="arena-stage">
          {gameId === "hero_cards" ? <CardsCanvas observation={cardsObs} names={names} /> : <ArenaCanvas observation={arenaObs} />}
          <div className="arena-overlay">
            {gameId !== "hero_cards" && <span className="badge">sample replay</span>}
            {observation && <span className="caption">tick {observation.tick.toLocaleString("en-US")}</span>}
          </div>
          {result && (
            <div className="result-card panel" role="status">
              <p className="eyebrow">Match over</p>
              <p className="h2">
                {result.outcome.status === "win" ? `${winner?.name ?? heroName(winnerHero)} wins` : "A draw"}
              </p>
              <p className="text-2">
                {heroName(winnerHero)} · {fmtTime(result.statistics.durationTicks)}
              </p>
              <div className="result-actions">
                <button className="btn primary" onClick={() => go("/dashboard")}>
                  See the report
                </button>
                <button className="btn secondary" onClick={() => go(`/lobby/${gameId}`)}>
                  Back to lobby
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
