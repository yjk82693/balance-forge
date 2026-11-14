import { setDemoVersion, useDemoVersion, type DemoVersion } from "../lib/demo";

const OPTIONS: { id: DemoVersion; label: string }[] = [
  { id: "broken", label: "Broken" },
  { id: "patched", label: "Patched" },
];

/** One control for the rematch scene: flips every screen between the broken and patched data. */
export function VersionToggle() {
  const v = useDemoVersion();
  return (
    <div className="seg" role="radiogroup" aria-label="Game data version">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={v === o.id}
          className={`seg-btn${v === o.id ? " on" : ""}`}
          onClick={() => setDemoVersion(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
