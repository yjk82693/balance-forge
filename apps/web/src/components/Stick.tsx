import { useRef, useState } from "react";
import type { InputPipeline } from "../lib/input";
import { stickVector } from "../lib/stick";

const KNOB = 72;
const REACH = 80; // px of knob travel that counts as full deflection

interface Props {
  pipeline: InputPipeline | null;
  disabled?: boolean;
}

/**
 * Floating stick: the whole left half of the controller is the touch area; the ring appears where the thumb lands.
 * Dead zone and full-speed distance are in lib/stick.ts. Touch-action is none: a drag never scrolls or zooms.
 */
export function Stick({ pipeline, disabled }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const ringEl = useRef<HTMLDivElement>(null);
  const ringPx = useRef(200);
  const active = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const [state, setState] = useState<{ ox: number; oy: number; kx: number; ky: number } | null>(null);

  const local = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent) => {
    if (disabled || active.current) return;
    const [x, y] = local(e);
    ringPx.current = ringEl.current?.offsetWidth || 160; // the ring is hidden until the touch starts
    active.current = { id: e.pointerId, ox: x, oy: y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setState({ ox: x, oy: y, kx: 0, ky: 0 });
  };
  const move = (e: React.PointerEvent) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    const [x, y] = local(e);
    let dx = x - a.ox;
    let dy = y - a.oy;
    const m = Math.hypot(dx, dy);
    if (m > REACH) {
      dx = (dx / m) * REACH;
      dy = (dy / m) * REACH;
    }
    setState({ ox: a.ox, oy: a.oy, kx: dx, ky: dy });
    const [vx, vy] = stickVector(dx, dy, REACH);
    pipeline?.setMove("touch", vx, vy);
  };
  const up = (e: React.PointerEvent) => {
    if (active.current?.id !== e.pointerId) return;
    active.current = null;
    setState(null);
    pipeline?.setMove("touch", 0, 0);
  };

  return (
    <div
      ref={area}
      className={`stick-area${disabled ? " dim" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="application"
      aria-label="Movement stick"
    >
      <div
        ref={ringEl}
        className="stick-ring on"
        style={
          state
            ? { left: state.ox - ringPx.current / 2, top: state.oy - ringPx.current / 2 }
            : { display: "none" }
        }
      />
      <div
        className="stick-knob on"
        style={
          state ? { left: state.ox + state.kx - KNOB / 2, top: state.oy + state.ky - KNOB / 2 } : { display: "none" }
        }
      />
    </div>
  );
}
