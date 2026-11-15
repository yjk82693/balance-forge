import { isArenaPayload, isCardsPayload, type CardsPayload, type Observation } from "../lib/contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { stubObservation } from "../lib/runnerStub";
import { saveJustPlayed } from "../lib/justPlayed";
import { go } from "../lib/router";
import { gameById } from "../lib/games";
import { heroName } from "../lib/heroes";
import { ArenaCanvas } from "../components/ArenaCanvas";
import { CardBanner } from "../components/CardBanner";
import { CardsCanvas } from "../components/CardsCanvas";
import { RunnerCanvas } from "../components/RunnerCanvas";
import { ARENA_KEY_HINT, MoveKeys, actionKey } from "../lib/pcKeys";
import { hasPcMode, usePlayMode } from "../lib/playMode";
import { pcSession, usePcSession } from "../lib/pcSession";
import { CardsHand } from "../components/CardsHand";
import { HeldKeys, KEYBOARD_HINT } from "../lib/runnerKeys";
import { TENTACLE_GAME_ID } from "../lib/tentacle";
import { isRunnerPayload, sectionLabel, type RunnerPayload } from "../lib/runner";
import { isVersusMatch, versusHeadline } from "../lib/runnerVersus";
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
  const tentacle = gameId === TENTACLE_GAME_ID;
  // PC mode: this tab holds the player seat (see the lobby) and the keyboard drives it.
  const pc = usePlayMode() === "pc" && hasPcMode(gameId);
  const pcState = usePcSession();
  const pcCards = pc && gameId === "hero_cards";
  const myCards =
    pcState.observation && isCardsPayload(pcState.observation.payload)
      ? (pcState.observation as Observation<CardsPayload>)
      : null;
  useEffect(() => {
    if (gameId === "hero_cards") return; // the hand handles its own keys

    if (!pc) return;
    const scrolling = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "];
    const stop = (e: KeyboardEvent) => scrolling.includes(e.key) && e.preventDefault(); // no page scroll
    if (gameId === TENTACLE_GAME_ID) {
      const held = new HeldKeys();
      const send = (c: { button: "jump" | "slide"; down: boolean } | null) => c && pcSession.press(c.button, c.down);
      const down = (e: KeyboardEvent) => (stop(e), send(held.change(e.key, true, e.repeat)));
      const up = (e: KeyboardEvent) => send(held.change(e.key, false));
      const blur = () => held.releaseAll().forEach((b) => pcSession.press(b, false));
      addEventListener("keydown", down);
      addEventListener("keyup", up);
      addEventListener("blur", blur);
      return () => {
        removeEventListener("keydown", down);
        removeEventListener("keyup", up);
        removeEventListener("blur", blur);
      };
    }
    const keys = new MoveKeys();
    const move = (v: [number, number] | null) => v && pcSession.move(v[0], v[1]);
    const down = (e: KeyboardEvent) => {
      stop(e);
      if (e.repeat) return;
      move(keys.change(e.key, true));
      const a = actionKey(e.key);
      if (a) pcSession.button(a);
    };
    const up = (e: KeyboardEvent) => move(keys.change(e.key, false));
    const blur = () => (keys.clear(), pcSession.move(0, 0));
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", blur);
    };
  }, [pc, gameId]);
  // Development only: #/arena/tentacle_run?stub=1 shows a made-up run (never in a production build).
  const stub = import.meta.env.DEV && tentacle && location.hash.includes("stub=1");
  const [stubTick, setStubTick] = useState(0);
  useEffect(() => {
    if (!stub) return;
    const t = setInterval(() => setStubTick((n) => n + 3), 50);
    return () => clearInterval(t);
  }, [stub]);
  const tentObs = stub
    ? stubObservation(stubTick)
    : tentacle && observation && isRunnerPayload(observation.payload)
      ? (observation as Observation<RunnerPayload>)
      : null;
  const names = Object.fromEntries((room?.seats ?? []).map((s) => [s.seat, s.name || heroName(s.hero)]));
  // the names typed on the phones (no fallback to a hero name: the versus labels fall back to P1 and P2)
  const typedNames = useMemo(
    () => Object.fromEntries((room?.seats ?? []).map((s) => [s.seat, s.name])),
    [room?.seats],
  );
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
  const versusEnded = tentacle && !!result && isVersusMatch(result.config.players);
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
          {tentacle ? (
            <RunnerCanvas observation={tentObs} names={typedNames} />
          ) : gameId === "hero_cards" ? (
            <>
              <CardsCanvas observation={cardsObs} names={names} heroes={heroes} />
              <CardBanner views={views} names={names} heroes={heroes} />
            </>
          ) : (
            <ArenaCanvas observation={arenaObs} events={events} views={views} bufferStats={bufferStats} />
          )}
          <DebugReadout stats={net} buffer={bufferStats} />
          {pcCards && (
            <div className="pc-hand">
              <CardsHand
                keys
                seat={pcState.seat ?? "p1"}
                hero={pcState.hero || "bari"}
                payload={myCards?.payload ?? null}
                tick={myCards?.tick ?? 0}
                names={names}
                online={pcState.status === "online"}
                send={(input) => pcSession.send(input)}
              />
            </div>
          )}
          <div className="arena-overlay">
            {gameId === "hero_arena" && <PlayBadge mock={isMockMode()} playing={room?.phase === "playing"} />}
            {tentObs && <span className="caption">{sectionLabel(tentObs.payload)}</span>}
            {pc && !pcCards && <span className="caption">{tentacle ? KEYBOARD_HINT : ARENA_KEY_HINT}</span>}
            {observation && <span className="caption">tick {observation.tick.toLocaleString("en-US")}</span>}
          </div>
          {srv === "unreachable" && !stub ? (
            <div className="stage-overlay">
              <ServerDown compact onRetry={() => transport?.reconnect()} />
            </div>
          ) : (
            !observation &&
            !stub && (
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
              <p className="eyebrow">{tentacle ? (versusEnded ? "Versus over" : "Run over") : "Match over"}</p>
              <p className="h2">
                {versusEnded
                  ? versusHeadline(result.outcome.winners, typedNames)
                  : tentacle
                  ? result.outcome.status === "win"
                    ? "The Man-Shark is down"
                    : "Sepia went down"
                  : result.outcome.status === "win"
                    ? `${winner?.name ?? heroName(winnerHero)} wins`
                    : "A draw"}
              </p>
              <p className="text-2">
                {tentacle && tentObs ? `${sectionLabel(tentObs.payload)} · ` : `${heroName(winnerHero)} · `}
                {fmtTime(result.statistics.durationTicks)}
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
