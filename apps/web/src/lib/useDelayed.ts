import { useEffect, useState } from "react";

/** `value` once it has been set for `ms` (at once for 0); it goes back to null as soon as the value is gone. */
export function useDelayed<T>(value: T | null | undefined, ms: number): T | null {
  const [shown, setShown] = useState<T | null>(null);
  useEffect(() => {
    if (value == null) {
      setShown(null);
      return;
    }
    if (ms <= 0) {
      setShown(value);
      return;
    }
    const t = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value == null ? null : ms <= 0 ? value : shown;
}
