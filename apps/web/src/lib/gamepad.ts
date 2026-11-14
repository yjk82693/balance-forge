import { useEffect, useState } from "react";
import type { ButtonAction, InputPipeline } from "./input";

const DEADZONE = 0.18;
// Standard mapping: A/cross = attack, B/circle = guard, X/square (or Y/triangle) = skill.
const BUTTONS: [number, ButtonAction][] = [
  [0, "melee"],
  [1, "guard"],
  [2, "projectile"],
  [3, "projectile"],
];

function radialDeadzone(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (m - DEADZONE) / (1 - DEADZONE));
  return [(x / m) * scaled, (y / m) * scaled];
}

/** Polls the Gamepad API and feeds the same pipeline as the touch controls. Returns the connected pad's name. */
export function useGamepad(pipeline: InputPipeline | null, enabled: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!pipeline || !enabled || typeof navigator.getGamepads !== "function") return;
    let raf = 0;
    const down = new Set<number>();
    const loop = () => {
      const pad = [...navigator.getGamepads()].find((g): g is Gamepad => !!g && g.connected);
      setName((prev) => (pad ? pad.id : null) === prev ? prev : pad ? pad.id : null);
      if (pad) {
        const [x, y] = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
        pipeline.setMove("gamepad", x, y);
        for (const [i, action] of BUTTONS) {
          const pressed = !!pad.buttons[i]?.pressed;
          if (pressed && !down.has(i)) {
            down.add(i);
            pipeline.press(action);
          } else if (!pressed) down.delete(i);
        }
      } else {
        pipeline.setMove("gamepad", 0, 0);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      pipeline.setMove("gamepad", 0, 0);
    };
  }, [pipeline, enabled]);
  return name;
}
