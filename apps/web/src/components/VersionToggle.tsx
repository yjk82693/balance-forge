import { setDemoVersion, useDemoVersion, type DemoVersion } from "../lib/demo";

const OPTIONS: { id: DemoVersion; label: string }[] = [
  { id: "broken", label: "Broken" },
  { id: "patched", label: "Patched" },
];

/** One control for the rematch scene: flips every screen between the broken and patched data. */
export function VersionToggle({ disabled = false, hint }: { disabled?: boolean; hint?: string }) {
  const v = useDemoVersion();
  return (
    <div className="seg" role="radiogroup" aria-label="Game data version" title={disabled ? hint : undefined}>
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
  );
}
