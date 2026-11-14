import { useSyncExternalStore } from "react";

/** Demo data version for the rematch scene: the "broken" (unbalanced) data or the "patched" data. */
export type DemoVersion = "broken" | "patched";

let version: DemoVersion = (() => {
  try {
    return sessionStorage.getItem("bf-demo-version") === "patched" ? "patched" : "broken";
  } catch {
    return "broken";
  }
})();
const subs = new Set<() => void>();

export function setDemoVersion(v: DemoVersion) {
  version = v;
  try {
    sessionStorage.setItem("bf-demo-version", v);
  } catch {
    /* storage blocked: version lives in memory only */
  }
  subs.forEach((f) => f());
}
export function useDemoVersion(): DemoVersion {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => version,
  );
}
