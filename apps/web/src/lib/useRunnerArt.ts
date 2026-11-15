import { useEffect, useState } from "react";
import { assetUrl } from "./assets";
import { probeSlot, slotPath } from "./runnerArt";

/** The URL of one art slot once it is known to exist, else null (the caller draws its fallback). */
export function useSlotUrl(slot: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    probeSlot(slot, assetUrl(slotPath(slot))).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [slot]);
  return url;
}
