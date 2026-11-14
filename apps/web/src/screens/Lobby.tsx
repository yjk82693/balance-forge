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
import { VersionToggle } from "../components/VersionToggle";
import { ServerDown, useServerState } from "../components/ServerDown";

const SLOTS = 2;
/** The room server starts a match with exactly two connected players. */
const PLAYERS_TO_START = 2;

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

export function Lobby({ gameId }: { gameId: string }) {
  useManifest();
  const game = gameById(gameId);
  const { transport, status } = useTransport("display", gameId);
  const { room } = useRoom(transport);
  const srv = useServerState(status);
  const [left, setLeft] = useState<string | null>(null);
  const prev = useRef(new Map<string, { name: string; connected: boolean }>());

  // Lobby always starts clean: a finished or running match from earlier is reset. The server needs the room's
  // id and epoch on every host message, so wait for the first room.status.
  const phase = room?.phase;
  const roomGame = room?.gameId;
  useEffect(() => {
    if (status !== "online" || !phase) return;
    if (roomGame && roomGame !== gameId) transport?.send("game.select", { gameId });
    if (phase !== "lobby") transport?.send("match.reset", {});
  }, [transport, status, phase, roomGame, gameId]);

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
  const connecting = !room;
  const code = room?.joinCode ?? "····";
  const url = joinUrl(code);
  const seats = room?.seats ?? [];
  const here = seats.filter((s) => s.connected).length;
  const arena = game.status === "ready";
  const canStart = here === PLAYERS_TO_START && arena && status === "online";
  const reason = !arena
    ? `${game.title} can't be played on the big screen yet.`
    : here < PLAYERS_TO_START
      ? `Waiting for ${PLAYERS_TO_START - here} more ${PLAYERS_TO_START - here === 1 ? "player" : "players"}`
      : "";
  const start = () => {
    if (!canStart) return;
    transport?.send("match.start", { gameId: game.id });
    go(`/arena/${game.id}`);
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
        <VersionToggle />
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
              Players · {here} of {SLOTS} here
            </span>
          </div>
          <ul className="chips" aria-live="polite" aria-busy={connecting}>
            {connecting && Array.from({ length: SLOTS }, (_, i) => <li key={`sk-${i}`} className="chip sk" />)}
            {!connecting && Array.from({ length: SLOTS }, (_, i) => {
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
            {connecting ? "Getting the room ready…" : (left ?? "Two players start a match.")}
          </p>
          <button className="btn primary touch" aria-disabled={!canStart} onClick={start}>
            Start match
          </button>
          {reason && <p className="caption lobby-note">{reason}</p>}
        </section>
      </main>
    </div>
  );
}
