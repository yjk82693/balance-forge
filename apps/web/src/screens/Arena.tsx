import { isArenaPayload, isCardsPayload, type CardsPayload, type Observation } from "../lib/contract";
import { useEffect, useRef } from "react";
import { saveJustPlayed } from "../lib/justPlayed";
import { go } from "../lib/router";
import { gameById } from "../lib/games";
import { heroName } from "../lib/heroes";
import { ArenaCanvas } from "../components/ArenaCanvas";
import { CardBanner } from "../components/CardBanner";
import { CardsCanvas } from "../components/CardsCanvas";
import { ServerDown, useServerState } from "../components/ServerDown";
import { SoundToggle } from "../components/SoundToggle";
import { isMockMode } from "../mock/types";
import { MockStatus, TopBar } from "../components/TopBar";
import { useTransport } from "../mock/transport";
import { useRoom } from "../mock/useRoom";
import { DebugReadout } from "../components/DebugReadout";
import { useNetStats } from "../lib/netStats";
import type { BufferStats } from "../lib/snapshotBuffer";

const fmtTime = (ticks: number) => {
  if (!Number.isFinite(ticks)) return "—";
  const s = Math.round(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** `live` while a real match runs (docs/ui-tone.md 4.4); the mock only ever replays a sample. */
function PlayBadge({ mock, playing }: { mock: boolean; playing: boolean }) {
  if (mock) return <span className="badge">sample replay</span>;
  return playing ? <span className="badge live"><span className="dot" />live</span> : null;
}

/** Laptop main screen: the arena as the players see it. */
export function Arena({ gameId }: { gameId: string }) {
  const game = gameById(gameId);
  // The room kept for this game: without the game id the big screen of Hero Cards joined a Hero Arena room instead.
  const { transport, status } = useTransport("display", gameId);
  const { room, observation, events, result, views } = useRoom(transport);
  const srv = useServerState(status);
  const net = useNetStats(transport);
  const bufferStats = useRef<BufferStats | null>(null);
  const arenaObs = observation && isArenaPayload(observation.payload) ? (observation as Observation) : null;
  const cardsObs =
    observation && isCardsPayload(observation.payload) ? (observation as Observation<CardsPayload>) : null;
  const names = Object.fromEntries((room?.seats ?? []).map((s) => [s.seat, s.name || heroName(s.hero)]));
  const heroes = Object.fromEntries((room?.seats ?? []).flatMap((s) => (s.hero ? [[s.seat, s.hero]] : [])));
  // Remember the finished match so the dashboard can show "you just played this".
  useEffect(() => {
    if (!result || gameId !== "hero_arena") return;
    const seats = room?.seats ?? [];
    saveJustPlayed({
      result,
      names: Object.fromEntries(seats.map((s) => [s.seat, s.name || heroName(s.hero)])),
      heroes: Object.fromEntries(seats.flatMap((s) => (s.hero ? [[s.seat, s.hero]] : []))),
    });
  }, [result, room, gameId]);
  const winnerSeat = result?.outcome.winners[0];
  const winner = room?.seats.find((s) => s.seat === winnerSeat);
  const winnerEntity = isArenaPayload(observation?.payload)
    ? observation.payload.entities.find((e) => e.id === winnerSeat)
    : undefined;
  const winnerHero = winnerEntity?.hero ?? winner?.hero;

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
        <SoundToggle />
        <MockStatus online={status === "online"} />
      </TopBar>
      <main className="arena-screen">
        <div className="arena-stage">
          {gameId === "hero_cards" ? (
            <>
              <CardsCanvas observation={cardsObs} names={names} heroes={heroes} />
              <CardBanner views={views} names={names} heroes={heroes} />
            </>
          ) : (
            <ArenaCanvas observation={arenaObs} events={events} views={views} bufferStats={bufferStats} />
          )}
          <DebugReadout stats={net} buffer={bufferStats} />
          <div className="arena-overlay">
            {gameId !== "hero_cards" && <PlayBadge mock={isMockMode()} playing={room?.phase === "playing"} />}
            {observation && <span className="caption">tick {observation.tick.toLocaleString("en-US")}</span>}
          </div>
          {srv === "unreachable" ? (
            <div className="stage-overlay">
              <ServerDown compact onRetry={() => transport?.reconnect()} />
            </div>
          ) : (
            !observation && (
              <div className="stage-overlay" aria-busy="true">
                <div className="panel">
                  <p className="eyebrow">{srv === "connecting" ? "Connecting" : "Waiting"}</p>
                  <p className="h3">
                    {srv === "connecting" ? "Reaching the server…" : "Waiting for the match to start."}
                  </p>
                  <p className="text-2">Start it from the lobby.</p>
                  <button className="btn secondary" style={{ marginTop: 12 }} onClick={() => go(`/lobby/${gameId}`)}>
                    Back to lobby
                  </button>
                </div>
              </div>
            )
          )}
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
