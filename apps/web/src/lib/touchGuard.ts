import { useEffect } from "react";

/**
 * While the controller is on screen, a drag or a pinch must not scroll or zoom the page. `touch-action: none` covers
 * the stick and the buttons; this covers the rest (iOS Safari still pinch-zooms on `gesturestart`, and drags outside
 * the stick would pull the page).
 */
export function usePreventPageGestures(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    document.addEventListener("touchmove", stop, { passive: false });
    const prev = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("touchmove", stop);
      document.body.style.overscrollBehavior = prev;
    };
  }, [active]);
}
