import { useEffect, useState } from "react";
import { HEROES, heroName } from "../lib/heroes";
import { ARENA_KEY_HINT } from "../lib/pcKeys";
import { PC_GAMES, setPlayMode, usePlayMode } from "../lib/playMode";
import { pcSession } from "../lib/pcSession";
import { KEYBOARD_HINT } from "../lib/runnerKeys";
import { TENTACLE_GAME_ID } from "../lib/tentacle";

const HERO_KEY = "bf-pc-hero";
function savedHero(): string {
  try {
    const h = localStorage.getItem(HERO_KEY);
    return HEROES.some((x) => x.id === h) ? (h as string) : "bari";
  } catch {
    return "bari";
  }
}

/** Mobile | PC for a game that has keyboard controls; the choice is remembered in this browser. */
export function PlayModeSwitch({ gameId }: { gameId: string }) {
  const mode = usePlayMode();
  if (!PC_GAMES.includes(gameId)) return null;
  return (
    <div className="seg play-mode" role="radiogroup" aria-label="How you play">
      {(["mobile", "pc"] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          className={`seg-btn${mode === m ? " on" : ""}`}
          onClick={() => {
            if (m === "mobile") pcSession.leave();
            setPlayMode(m);
          }}
        >
          {m === "mobile" ? "Mobile" : "PC"}
        </button>
      ))}
    </div>
  );
}

/**
 * PC mode in the lobby: this tab takes the player seat of the room it hosts and plays with the keyboard. No QR code.
 * `code` is the room's join code (null until the room is ready).
 */
export function PcPanel({ gameId, code }: { gameId: string; code: string | null }) {
  const solo = gameId === TENTACLE_GAME_ID;
  const [hero, setHero] = useState(savedHero);
  const hint = solo ? KEYBOARD_HINT : ARENA_KEY_HINT;
  useEffect(() => {
    if (code) pcSession.join(gameId, code, solo ? "sepia" : hero);
  }, [gameId, code, hero, solo]);
  const pick = (id: string) => {
    setHero(id);
    try {
      localStorage.setItem(HERO_KEY, id);
    } catch {
      /* the choice lasts until the page is left */
    }
  };
  return (
    <section className="lobby-join" aria-labelledby="join-title">
      <h1 id="join-title" className="display">
        Play on this computer
      </h1>
      <p className="h3 text-2">You take the player seat in this tab. {hint}</p>
      {!solo && (
        <fieldset className="heroes seated-heroes">
          <legend className="caption">Your hero</legend>
          {HEROES.map((h) => (
            <label key={h.id} className={`hero-pick${hero === h.id ? " on" : ""}`}>
              <input type="radio" name="pc-hero" checked={hero === h.id} onChange={() => pick(h.id)} />
              <span className="small">{heroName(h.id)}</span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
