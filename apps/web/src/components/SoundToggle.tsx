import { setMuted, useMuted } from "../lib/sfx";

export function SoundToggle({ className = "btn secondary" }: { className?: string }) {
  const muted = useMuted();
  return (
    <button className={className} aria-pressed={!muted} onClick={() => setMuted(!muted)}>
      {muted ? "Sound off" : "Sound on"}
    </button>
  );
}
