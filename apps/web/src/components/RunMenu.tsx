import { useEffect, useRef, useState, type ReactNode } from "react";

/** The less-used controls behind one button, so the top bar keeps to what a run needs. */
export function RunMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="run-menu" ref={box}>
      <button className="btn secondary" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        Options
      </button>
      {open && (
        <div className="run-menu-panel" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}
