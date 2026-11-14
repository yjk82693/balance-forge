import { useEffect, useMemo, useRef, useState } from "react";
import { isArenaPayload, isCardsPayload, type CardsPayload } from "../lib/contract";
import { HEROES, heroColorVar, heroName } from "../lib/heroes";
import { HeroPortrait } from "../components/HeroPortrait";
import { Stick } from "../components/Stick";
import { ActionButton } from "../components/ActionButton";
import { useManifest } from "../lib/assets";
import { go } from "../lib/router";
import { InputPipeline } from "../lib/input";
import { useGamepad } from "../lib/gamepad";
import { ServerDown, useServerState } from "../components/ServerDown";
import { SoundToggle } from "../components/SoundToggle";
import { blip, buzz } from "../lib/sfx";
import { CardsHand } from "../components/CardsHand";
import { useTransport } from "../mock/transport";
import { useRoom } from "../mock/useRoom";

const ERRORS: Record<string, string> = {
  AUTH_EXPIRED: "That code didn't match. Check the big screen and try again.",
  ROOM_FULL: "This room is full. Ask the host to open a slot.",
};

/** This seat's entity in an arena observation, if the payload is one. */
function myArenaEntity(payload: unknown, seat: string | undefined) {
  return isArenaPayload(payload) ? payload.entities.find((e) => e.id === seat) : undefined;
}

const hpPercent = (hp: number, maxHp = 100) => Math.max(0, Math.min(100, (hp / maxHp) * 100));

interface Profile {
  code: string;
  name: string;
  hero: string;
}

export function Controller({ initialCode }: { initialCode: string }) {
  useManifest();
  const { transport, status } = useTransport("controller");
  const { room, observation, config, result, error } = useRoom(transport);
  const [profile, setProfile] = useState<Profile>({ code: initialCode.toUpperCase(), name: "", hero: "bari" });
  const [joined, setJoined] = useState<Profile | null>(null);
  const seat = room?.you;
  const tick = useRef(0);
  tick.current = observation?.tick ?? tick.current;

  const pipeline = useMemo(
    () =>
      transport && seat
        ? new InputPipeline(
            seat,
            () => tick.current + 1,
            (input) => transport.send("input.submit", input),
          )
        : null,
    [transport, seat],
  );
  useEffect(() => () => pipeline?.dispose(), [pipeline]);

  const gameId = room?.gameId ?? config?.gameId ?? "hero_arena";
  const srv = useServerState(status);
  const online = status === "online";
  const playing = !!seat && !!joined;
  const padName = useGamepad(pipeline, playing && online);

  useEffect(() => {
    if (import.meta.env.DEV && transport) {
      (window as unknown as { __bf?: unknown }).__bf = { drop: () => transport.drop() }; // dev-only test hook
    }
  }, [transport]);

  const join = (p: Profile) => {
    setJoined(p);
    transport?.send("room.join", { joinCode: p.code, name: p.name.trim() || "Player", hero: p.hero });
  };
  const rejoin = () => {
    transport?.reconnect();
  };
  // After a dropped connection comes back, take a seat again (not on the first join).
  const wasLost = useRef(false);
  useEffect(() => {
    if (status === "lost") {
      wasLost.current = true;
    } else if (status === "online" && wasLost.current && joined) {
      wasLost.current = false;
      transport?.send("room.join", { joinCode: joined.code, name: joined.name.trim() || "Player", hero: joined.hero });
    }
  }, [status, joined, transport]);
  useEffect(() => {
    if (error && joined && !seat) setJoined(null);
  }, [error, joined, seat]);

  // Phone haptics and blips follow our own HP in the observation: a short pulse on a hit, a longer one on KO.
  const myHp = myArenaEntity(observation?.payload, seat)?.hp;
  const lastHp = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (myHp === undefined) return;
    const prev = lastHp.current;
    lastHp.current = myHp;
    if (prev === undefined || myHp >= prev) return;
    if (myHp <= 0) {
      buzz([60, 40, 120]);
      blip("ko");
    } else {
      buzz(25);
      blip("hit");
    }
  }, [myHp]);

  if (!playing) {
    return (
      <JoinForm
        gameId={gameId}
        profile={profile}
        onChange={setProfile}
        onJoin={join}
        busy={!!joined && !error}
        error={error ? (ERRORS[error.code] ?? "Something went wrong. Try again.") : null}
        offline={status === "lost"}
        srv={srv}
        onRetry={() => transport?.reconnect()}
      />
    );
  }

  const me = room?.seats.find((s) => s.seat === seat);
  const hero = me?.hero ?? joined.hero;
  const mine = myArenaEntity(observation?.payload, seat);
  const ended = !!result || room?.phase === "ended";
  const gameOn = room?.phase === "playing";

  return (
    <div className="phone" style={{ ["--hero" as string]: heroColorVar(hero) }}>
      <header className="phone-head">
        <HeroPortrait hero={hero} size={32} />
        <span className="phone-name">{me?.name || heroName(hero)}</span>
        <span className={`status ${online ? "ok" : "bad"}`} role="status">
          <span className="dot" />
          {online ? "connected" : "disconnected"}
        </span>
        <span className="caption phone-code">{joined.code}</span>
      </header>
      {!online && (
        <div className="lost-bar" role="alert">
          <span>Lost the connection.</span>
          <button className="lost-btn" onClick={rejoin}>
            Tap to rejoin.
          </button>
        </div>
      )}
      {gameId === "hero_cards" ? (
        <CardsHand
          seat={seat!}
          hero={hero}
          payload={isCardsPayload(observation?.payload) ? (observation!.payload as CardsPayload) : null}
          tick={tick.current}
          names={Object.fromEntries((room?.seats ?? []).map((s) => [s.seat, s.name || heroName(s.hero)]))}
          online={online}
          send={(input) => transport?.send("input.submit", input)}
        />
      ) : (
      <>
      <section className="phone-body" aria-live="polite">
        {ended ? (
          <p>Thanks for playing. Your match is recorded.</p>
        ) : (
          <p>
            You're {heroName(hero)}.
            <br />
            <span className="text-2">{gameOn ? "Watch the big screen." : "Waiting for the host to start."}</span>
          </p>
        )}
        {mine && (
          <div className="hp" aria-label={`HP ${mine.hp}`}>
            <span className="caption">HP</span>
            <span className="hp-track">
              <span className="hp-fill" style={{ width: `${hpPercent(mine.hp, mine.maxHp)}%` }} />
            </span>
            <span className="small">{mine.hp}</span>
          </div>
        )}
        {padName && <p className="caption">Gamepad connected</p>}
      </section>
      <div className={`pad${online ? "" : " dim"}`}>
        <Stick pipeline={pipeline} disabled={!online} />
        <div className="btn-cluster">
          <ActionButton
            className="b-guard"
            label="Guard"
            size={72}
            icon="assets/hero_arena/ui/skill_guard.png"
            disabled={!online}
            onPress={() => pipeline?.press("guard")}
          />
          <ActionButton
            className="b-attack"
            label="Attack"
            size={88}
            icon="assets/hero_arena/ui/skill_melee.png"
            disabled={!online}
            onPress={() => pipeline?.press("melee")}
          />
          <ActionButton
            className="b-skill"
            label="Skill"
            size={72}
            icon="assets/hero_arena/ui/skill_projectile.png"
            disabled={!online}
            onPress={() => pipeline?.press("projectile")}
          />
        </div>
      </div>
      </>
      )}
      <footer className="phone-foot">
        <SoundToggle className="btn secondary touch" />
        <button className="btn secondary touch" onClick={() => go(`/join?r=${Date.now()}`)}>
          Leave
        </button>
      </footer>
      <div className="rotate-hint" role="alert">
        Turn your phone upright
      </div>
    </div>
  );
}

function JoinForm(props: {
  gameId: string;
  profile: Profile;
  onChange: (p: Profile) => void;
  onJoin: (p: Profile) => void;
  busy: boolean;
  error: string | null;
  offline: boolean;
  srv: "ok" | "connecting" | "unreachable";
  onRetry: () => void;
}) {
  const { profile, onChange, onJoin, busy, error, offline, gameId, srv, onRetry } = props;
  if (srv === "unreachable") {
    return (
      <div className="phone join">
        <ServerDown compact onRetry={onRetry} />
      </div>
    );
  }
  const ok = profile.code.length >= 4;
  return (
    <form
      className="phone join"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy && props.srv === "ok") onJoin(profile);
      }}
    >
      <h1 className="h2">Pick your hero</h1>
      <label className="field">
        <span className="caption">Room code</span>
        <input
          className="input code-input"
          value={profile.code}
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          onChange={(e) => onChange({ ...profile, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
        />
      </label>
      <label className="field">
        <span className="caption">Your name</span>
        <input
          className="input"
          value={profile.name}
          maxLength={16}
          placeholder="Player"
          autoComplete="nickname"
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
        />
      </label>
      <fieldset className="heroes">
        <legend className="caption">Hero</legend>
        {HEROES.map((h) => {
          const planned = !!h.plannedIn?.includes(gameId);
          return (
            <label
              key={h.id}
              className={`hero-pick${profile.hero === h.id ? " on" : ""}${planned ? " planned" : ""}`}
              style={{ ["--hero" as string]: `var(${h.cssVar})` }}
            >
              <input
                type="radio"
                name="hero"
                value={h.id}
                disabled={planned}
                checked={profile.hero === h.id}
                onChange={() => onChange({ ...profile, hero: h.id })}
              />
              <HeroPortrait hero={h.id} size={56} dim={planned} />
              <span className="small">{h.name}</span>
              {planned && <span className="badge planned">planned</span>}
            </label>
          );
        })}
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {offline && <p className="form-error">Lost the connection. Tap Join to try again.</p>}
      <button
        className="btn primary touch"
        type="submit"
        aria-disabled={!ok || busy || srv === "connecting"}
        aria-busy={busy || srv === "connecting"}
      >
        {srv === "connecting" ? "Connecting…" : busy ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
