import { setDemoVersion, useDemoVersion, type DemoVersion } from "../lib/demo";

const OPTIONS: { id: DemoVersion; label: string }[] = [
  { id: "broken", label: "Broken" },
  { id: "patched", label: "Patched" },
];

/**
 * A view switch of the dashboard: shows the run's broken (before) or patched (after) result. It does not change the
 * data a room plays on; that is the lobby's own toggle (LobbyVersion).
 */
export function VersionToggle({ disabled = false, hint }: { disabled?: boolean; hint?: string }) {
  const v = useDemoVersion();
  return (
    <div className="view-switch">
      <span className="caption">View</span>
      <div
        className="seg"
        role="radiogroup"
        aria-label="Result view (not the game data)"
        title={disabled ? hint : undefined}
      >
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={v === o.id}
            aria-disabled={disabled}
            className={`seg-btn${v === o.id ? " on" : ""}`}
            onClick={() => !disabled && setDemoVersion(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
