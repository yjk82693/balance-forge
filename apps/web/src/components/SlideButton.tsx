import { useState } from "react";
import { useSlotUrl } from "../lib/useRunnerArt";

interface Props {
  disabled?: boolean;
  /** true when the finger goes down, false when it comes up or the touch is cancelled */
  onHold: (down: boolean) => void;
}

/** SLIDE: held while the finger is on it. */
export function SlideButton({ disabled, onHold }: Props) {
  const [down, setDown] = useState(false);
  const art = useSlotUrl("btn_slide");
  const artDown = useSlotUrl("btn_slide_pressed");
  const set = (next: boolean) => {
    if (down === next) return;
    setDown(next);
    onHold(next);
  };
  return (
    <div className="pad-btn-wrap runner-slide">
      <button
        type="button"
        className={`pad-btn runner-btn slide-btn${down ? " pressed" : ""}${art ? " art" : ""}`}
        disabled={disabled}
        aria-label="Slide: hold to slide under low bars"
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
        {art ? (
          <img className="runner-art" src={down && artDown ? artDown : art} alt="" draggable={false} />
        ) : (
          <span className="slide-glyph" aria-hidden="true">
            ⤓
          </span>
        )}
      </button>
      <span className="pad-label">Hold: slide</span>
    </div>
  );
}
