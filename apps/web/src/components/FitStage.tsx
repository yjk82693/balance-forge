import { useEffect, useRef, useState, type ReactNode } from "react";

const W = 1920;
const H = 1080;

/**
 * Lays children out on a 1920x1080 canvas and scales it to fit the window (docs/ui-tone.md section 07).
 * Below 1100px wide it just flows.
 */
export function FitStage({ children }: { children: ReactNode }) {
  const [k, setK] = useState(() => (innerWidth >= 1100 ? Math.min(innerWidth / W, innerHeight / H) : 0));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = () => setK(innerWidth >= 1100 ? Math.min(innerWidth / W, innerHeight / H) : 0);
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  if (!k) return <>{children}</>;
  return (
    <div className="fit-outer" style={{ width: W * k, height: H * k }}>
      <div ref={ref} className="fit-inner" style={{ width: W, height: H, transform: `scale(${k})` }}>
        {children}
      </div>
    </div>
  );
}
