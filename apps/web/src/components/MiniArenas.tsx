import { useEffect, useRef } from "react";

const COLS = 5;
const ROWS = 2;
const CW = 84;
const CH = 48;
const GAP = 8;
const W = COLS * CW + (COLS - 1) * GAP;
const H = ROWS * CH + (ROWS - 1) * GAP;
// Identity colors for texture only (dark-theme hero tokens).
const DOTS = ["#2EC4B6", "#FF8A3D", "#A3B65E", "#B08AF0", "#F0525A"];

/** A grid of tiny arenas with moving dots: pure texture while the bots play. It carries no data. */
export function MiniArenas({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr;
    c.height = H * dpr;
    ctx.scale(dpr, dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < COLS * ROWS; i++) {
        const x = (i % COLS) * (CW + GAP);
        const y = Math.floor(i / COLS) * (CH + GAP);
        ctx.fillStyle = "#1B2430";
        ctx.beginPath();
        ctx.roundRect(x, y, CW, CH, 6);
        ctx.fill();
        ctx.strokeStyle = "#2B3747";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = active ? 1 : 0.35;
        for (let d = 0; d < 2; d++) {
          const ph = t / 900 + i * 1.7 + d * 3.1;
          const px = x + CW / 2 + Math.sin(ph * (0.8 + d * 0.3)) * (CW / 2 - 10) * (d ? -1 : 1) * 0.9;
          const py = y + CH / 2 + Math.cos(ph * 1.1 + d) * (CH / 2 - 9);
          ctx.fillStyle = DOTS[(i + d * 2) % DOTS.length];
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };
    if (reduce || !active) {
      draw(0);
      return;
    }
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return <canvas ref={ref} className="minis" style={{ width: W, height: H }} aria-hidden="true" />;
}
