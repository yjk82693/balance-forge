import { useCallback, useEffect, useState } from "react";

export type SceneId = "match" | "intent" | "bots" | "profile" | "patch" | "replay" | "verdict" | "history";

export interface Scene {
  id: SceneId;
  title: string;
  /** seconds the scene stays on screen at least, before it may advance by itself */
  min: number;
}

const MATCH_SCENE: Scene = { id: "match", title: "The match", min: 5 };
const INTENT_SCENE: Scene = { id: "intent", title: "What the designer wants", min: 8 };
const BOTS_SCENE: Scene = { id: "bots", title: "Bots play", min: 8 };
const PROFILE_SCENE: Scene = { id: "profile", title: "Hero profile", min: 12 };
const MIDDLE_SCENES: Scene[] = [
  { id: "patch", title: "The patch", min: 8 },
  { id: "replay", title: "Same seed, both versions", min: 12 },
];

/**
 * The flow. The design intent chart comes before the bots when the designer wants anything but even. The hero profile
 * comes between the result and the patch when the run has a diagnosis; the version history comes last when there is
 * one to show, otherwise the verdict is the end.
 */
export function scenesFor(opts: { intent: boolean; profile: boolean; history: boolean }): Scene[] {
  const verdict: Scene = { id: "verdict", title: "Verdict", min: opts.history ? 8 : 0 };
  const history: Scene[] = opts.history ? [{ id: "history", title: "Version history", min: 0 }] : [];
  const first = [MATCH_SCENE, ...(opts.intent ? [INTENT_SCENE] : []), BOTS_SCENE];
  return [...first, ...(opts.profile ? [PROFILE_SCENE] : []), ...MIDDLE_SCENES, verdict, ...history];
}

const TICK_MS = 250;

/** True when the page was opened with ?auto=1 (in the query string or after the hash). */
export function isAutoMode(hashQuery: URLSearchParams): boolean {
  return new URLSearchParams(location.search).get("auto") === "1" || hashQuery.get("auto") === "1";
}

/**
 * Scene clock for the presenter. A scene advances by itself once its minimum time has passed and `ready` says its data
 * is in; the last scene stays. Keys: Space/Right next, Left previous, P pause, R restart.
 */
export function usePresenter(scenes: Scene[], ready: (id: SceneId) => boolean, onRestart: () => void) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(0); // seconds in the current scene
  const [paused, setPaused] = useState(false);
  const last = scenes.length - 1;

  const goTo = useCallback(
    (i: number) => {
      setIndex(Math.max(0, Math.min(last, i)));
      setHeld(0);
    },
    [last],
  );

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setHeld((h) => h + TICK_MS / 1000), TICK_MS);
    return () => clearInterval(t);
  }, [paused]);

  const scene = scenes[Math.min(index, last)];
  useEffect(() => {
    if (!paused && index < last && held >= scene.min && ready(scene.id)) goTo(index + 1);
  }, [held, paused, index, last, scene, ready, goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === " " || key === "arrowright") goTo(index + 1);
      else if (key === "arrowleft") goTo(index - 1);
      else if (key === "p") setPaused((p) => !p);
      else if (key === "r") {
        goTo(0);
        setPaused(false);
        onRestart();
      } else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [goTo, index, onRestart]);

  return { index, scene, held, paused, goTo, last };
}
