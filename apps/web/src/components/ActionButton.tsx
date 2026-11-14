import { useState } from "react";
import { manifestUrl } from "../lib/assets";

interface Props {
  label: string;
  size: 72 | 88;
  icon: string; // manifest path of a 256px kit glyph, drawn at 32px
  className: string;
  disabled?: boolean;
  onPress: () => void;
}

/** Code-drawn circle; the kit glyph is the only image. */
export function ActionButton({ label, size, icon, className, disabled, onPress }: Props) {
  const [pressed, setPressed] = useState(false);
  const src = manifestUrl(icon);
  return (
    <div className={`pad-btn-wrap ${className}`}>
      <button
        type="button"
        className={`pad-btn${pressed ? " pressed" : ""}`}
        style={{ width: size, height: size }}
        disabled={disabled}
        aria-label={label}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setPressed(true);
          navigator.vibrate?.(10);
          onPress();
        }}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {src && <img src={src} width={32} height={32} alt="" draggable={false} />}
      </button>
      <span className="pad-label">{label}</span>
    </div>
  );
}
