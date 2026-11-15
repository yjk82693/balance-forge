import { useEffect, useRef, useState } from "react";
import { manifestUrl } from "../lib/assets";
import { chargeFraction } from "../lib/tentacleButton";

interface Props {
  disabled?: boolean;
  /** the labels under the button: what a tap does, what a hold does */
  tapWord?: string;
  holdWord?: string;
  /** true when the finger goes down, false when it comes up or the touch is cancelled */
  onHold: (down: boolean) => void;
}

const SIZE = 112;
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** JUMP: held while the finger is down (tap = jump, hold = wire, decided by the engine); a ring shows the hold. */
export function TentacleButton({ disabled, onHold, tapWord = "jump", holdWord = "wire" }: Props) {
  const [charge, setCharge] = useState(0);
  const [holding, setHolding] = useState(false);
  const since = useRef<number | null>(null);
  const frame = useRef(0);
  const icon = manifestUrl("assets/sepia_tentacle_run/ui/icon_tentacle.png");

  const stop = () => {
    cancelAnimationFrame(frame.current);
    since.current = null;
    setHolding(false);
    setCharge(0);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const tick = () => {
    if (since.current === null) return;
    setCharge(chargeFraction(performance.now() - since.current));
    frame.current = requestAnimationFrame(tick);
  };
  const ready = charge >= 1;

  return (
    <div className="pad-btn-wrap b-attack">
      <button
        type="button"
        className={`pad-btn tentacle-btn${holding ? " pressed" : ""}${ready ? " ready" : ""}`}
        style={{ width: SIZE, height: SIZE }}
        disabled={disabled}
        aria-label={`Tap to ${tapWord}, hold for the ${holdWord}`}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          navigator.vibrate?.(10);
          since.current = performance.now();
          setHolding(true);
          frame.current = requestAnimationFrame(tick);
          onHold(true);
        }}
        onPointerUp={() => {
          const was = since.current !== null;
          stop();
          if (was) onHold(false);
        }}
        onPointerCancel={() => {
          const was = since.current !== null;
          stop();
          if (was) onHold(false);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="tentacle-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} className="ring-track" />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            className="ring-fill"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - charge)}
          />
        </svg>
        {icon && <img src={icon} width={40} height={40} alt="" draggable={false} />}
      </button>
      <span className="pad-label">
        {holding ? (ready ? `Release: let go` : `Hold: ${holdWord}`) : `Tap: ${tapWord} · hold: ${holdWord}`}
      </span>
    </div>
  );
}
