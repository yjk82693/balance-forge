import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { gameById } from "../lib/games";
import { go } from "../lib/router";
import { heroColorVar, heroName } from "../lib/heroes";
import { HeroPortrait } from "../components/HeroPortrait";
import { MockStatus, TopBar } from "../components/TopBar";
import { useManifest } from "../lib/assets";
import { useTransport } from "../mock/transport";
import { useRoom } from "../mock/useRoom";
import { LobbyVersion } from "../components/LobbyVersion";
import { ServerDown, useServerState } from "../components/ServerDown";

const SLOTS = 2;
/** Games played alone: one seat starts the run. */
const SOLO_GAMES = ["tentacle_run"];
const START_WAIT_MS = 6000;
/** The room server starts a match with exactly two connected players. */
const PLAYERS_TO_START = 2;

/** What to tell the host when the server refused to start a match. */
function startError(code: string, message?: string): string {
  if (code === "ILLEGAL_ACTION") return "The server can't start yet. It needs two players, or one player and a bot.";
  if (code === "INVALID_SCHEMA") return "This server can't start a match against a bot yet.";
  return message ? `Couldn't start: ${message}` : "Couldn't start the match. Try again.";
}

function joinUrl(code: string) {
  return `${location.origin}${location.pathname}#/play?code=${code}`;
}

function Qr({ url }: { url: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => alive && (setSvg(s), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [url]);
  if (failed) return <p className="small qr-fallback">Couldn't draw the QR code. Open the address below.</p>;
  return (
    <div
      className="qr"
      role="img"
      aria-label={`QR code to join: ${url}`}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

export function Lobby({ gameId, dataHash }: { gameId: string; dataHash?: string }) {
  useManifest();
  const game = gameById(gameId);
  const { transport, status } = useTransport("display", gameId);
  const { room, error } = useRoom(transport);
  const [starting, setStarting] = useState<null | "match" | "bot">(null);
  const [refusal, setRefusal] = useState("");
  const srv = useServerState(status);
  const [left, setLeft] = useState<string | null>(null);
  const prev = useRef(new Map<string, { name: string; connected: boolean }>());

  // Lobby always starts clean: a finished or running match from earlier is reset. The server needs the room's
  // id and epoch on every host message, so wait for the first room.status.
  const phase = room?.phase;
  const roomGame = room?.gameId;
  const cleaned = useRef(false);
  useEffect(() => {
    // Once per visit: a match that starts from this lobby must not be reset by its own status change.
    if (status !== "online" || !phase || cleaned.current) return;
    cleaned.current = true;
    // A version picked on the Versions screen (?hash=) is selected for this room; the server keeps it for the match.
    if (dataHash) transport?.send("game.select", { gameId, dataHash });
    else if (roomGame && roomGame !== gameId) transport?.send("game.select", { gameId });
    if (phase !== "lobby") transport?.send("match.reset", {});
  }, [transport, status, phase, roomGame, gameId, dataHash]);

  // Go to the big screen once the server says the match is on; if it refuses, stay here and say why.
  useEffect(() => {
    if (!starting) return;
    if (phase === "playing") go(`/arena/${gameId}`);
    else if (error) {
      setStarting(null);
      setRefusal(startError(error.code, error.message));
      return;
    }
    // No answer at all (dropped connection, silent server): do not leave the buttons disabled forever.
    const t = setTimeout(() => {
      setStarting(null);
      setRefusal("The server didn't answer. Try again.");
    }, START_WAIT_MS);
    return () => clearTimeout(t);
  }, [starting, phase, error, gameId]);

  useEffect(() => {
    if (!room) return;
    for (const s of room.seats) {
      const was = prev.current.get(s.seat);
      if (was?.connected && !s.connected) setLeft(`${was.name} left`);
      prev.current.set(s.seat, { name: s.name, connected: s.connected });
    }
  }, [room]);
  useEffect(() => {
    if (!left) return;
    const t = setTimeout(() => setLeft(null), 4000);
    return () => clearTimeout(t);
  }, [left]);

  if (!game) return <TopBar />;
  if (srv === "unreachable") {
    return (
      <div className="screen">
        <TopBar>
          <a className="link-back" href="#/">
            ← Games
          </a>
          <span className="spacer" />
          <MockStatus online={false} />
        </TopBar>
        <main className="boundary">
          <ServerDown onRetry={() => transport?.reconnect()} />
        </main>
      </div>
    );
  }
  const solo = SOLO_GAMES.includes(gameId);
  const slots = solo ? 1 : SLOTS;
  const needed = solo ? 1 : PLAYERS_TO_START;
  const connecting = !room;
  const code = room?.joinCode ?? "····";
  const url = joinUrl(code);
  const seats = room?.seats ?? [];
  const here = seats.filter((s) => s.connected).length;
  const arena = game.status === "ready";
  const canStart = here === needed && arena && status === "online";
  const reason = !arena
    ? `${game.title} can't be played on the big screen yet.`
    : here < needed
      ? `Waiting for ${needed - here} more ${needed - here === 1 ? "player" : "players"}`
      : "";
  const canBot = here >= 1 && arena && status === "online";
  const begin = (bot: boolean) => {
    if (bot ? !canBot : !canStart) return;
    setRefusal("");
    setStarting(bot ? "bot" : "match");
    transport?.send("match.start", bot ? { gameId: game.id, bot: true } : { gameId: game.id });
  };

  return (
    <div className="screen" style={{ ["--game" as string]: `var(${game.accentVar})` }}>
      <TopBar>
        <a className="link-back" href="#/">
          ← Games
        </a>
        <span className="eyebrow" style={{ color: "var(--game)" }}>
          {game.eyebrow}
        </span>
        <span className="spacer" />
        {dataHash && <span className="badge after">version {dataHash.slice(0, 7)}</span>}
        <LobbyVersion
          transport={transport}
          gameId={gameId}
          ready={status === "online" && !!room}
          fixed={!!dataHash}
        />
        <MockStatus online={status === "online"} />
      </TopBar>
      <div className="lobby-bar" />
      <main className="lobby">
        <section className="lobby-join" aria-labelledby="join-title">
          <h1 id="join-title" className="display">
            Scan to join
          </h1>
          <div className="join-row">
            <div className="qr-card">
              {connecting ? (
                <div className="sk" style={{ aspectRatio: "1", width: "100%" }} aria-label="Getting the room ready" />
              ) : (
                <Qr url={url} />
              )}
            </div>
            <div className="join-code">
              <p className="eyebrow text-2" style={{ color: "var(--text-2)" }}>
                Room code
              </p>
              <p className="room-code" aria-label={`Room code ${code.split("").join(" ")}`}>
                {code}
              </p>
              <p className="text-2">
                or open <span className="join-url">{location.host}{location.pathname.replace(/\/$/, "")}/#/join</span>
              </p>
            </div>
          </div>
        </section>

        <section className="panel lobby-players" aria-labelledby="players-title">
          <div className="panel-head">
            <span id="players-title" className="eyebrow">
              Players · {here} of {slots} here
            </span>
          </div>
          <ul className="chips" aria-live="polite" aria-busy={connecting}>
            {connecting && Array.from({ length: slots }, (_, i) => <li key={`sk-${i}`} className="chip sk" />)}
            {!connecting && Array.from({ length: slots }, (_, i) => {
              const s = seats[i];
              if (!s) {
                return (
                  <li key={`open-${i}`} className="chip open">
                    <HeroPortrait hero="bari" size={56} ring={false} dim />
                    <div>
                      <p className="small text-2">Open slot</p>
                      <p className="caption">Waiting…</p>
                    </div>
                  </li>
                );
              }
              return (
                <li
                  key={s.seat}
                  className={`chip${s.connected ? "" : " away"}`}
                  style={{ ["--hero-chip" as string]: heroColorVar(s.hero) }}
                >
                  <HeroPortrait hero={s.hero} size={56} />
                  <div className="chip-name">
                    <p className="small" style={{ fontWeight: 700 }}>
                      {s.name || "Player"}
                    </p>
                    <p className="caption">{heroName(s.hero)}</p>
                  </div>
                  <span className="badge human">human</span>
                  <span className={`status ${s.connected ? "ok" : ""}`}>
                    <span className="dot" />
                    {s.connected ? "ready" : "waiting"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="caption lobby-note" aria-live="polite">
            {connecting
              ? "Getting the room ready…"
              : (left ?? (solo ? "One player starts the run." : "Two players start a match."))}
          </p>
          <button
            className="btn primary touch"
            aria-disabled={!canStart || !!starting}
            aria-busy={starting === "match"}
            onClick={() => begin(false)}
          >
            {solo ? "Start run" : "Start match"}
          </button>
          {!solo && (
            <button
              className="btn secondary touch"
              aria-disabled={!canBot || !!starting}
              aria-busy={starting === "bot"}
              onClick={() => begin(true)}
            >
              Play vs bot
            </button>
          )}
          {(refusal || reason) && (
            <p className="caption lobby-note" role={refusal ? "alert" : undefined}>
              {refusal || reason}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
