import { useState } from "react";
import { manifestUrl } from "../lib/assets";

interface Props {
  disabled?: boolean;
  /** true when the finger goes down, false when it comes up or the touch is cancelled */
  onHold: (down: boolean) => void;
}

/**
 * JUMP: held while the finger is down. The engine decides what that means: a press is a jump, a second press in the air
 * near an anchor hooks the wire, holding it swings, releasing lets go.
 */
export function TentacleButton({ disabled, onHold }: Props) {
  const [down, setDown] = useState(false);
  const icon = manifestUrl("assets/sepia_tentacle_run/ui/icon_tentacle.png");
  const set = (next: boolean) => {
    if (down === next) return;
    setDown(next);
    onHold(next);
  };
  return (
    <div className="pad-btn-wrap runner-jump">
      <button
        type="button"
        className={`pad-btn runner-btn${down ? " pressed" : ""}`}
        disabled={disabled}
        aria-label="Jump: press again in the air to hook the wire"
        aria-pressed={down}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          navigator.vibrate?.(10);
          set(true);
        }}
        onPointerUp={() => set(false)}
        onPointerCancel={() => set(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {icon && <img src={icon} width={48} height={48} alt="" draggable={false} />}
      </button>
      <span className="pad-label">Jump · press again in the air to hook</span>
    </div>
  );
}
