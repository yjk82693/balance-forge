import type { ReactNode } from "react";

export function Brand() {
  return (
    <a className="brand" href="#/">
      <span className="brand-mark" aria-hidden="true" />
      <span>Playtest</span>
    </a>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <Brand />
      {children}
    </header>
  );
}

/** Honest status: we only talk to the in-browser mock server for now. */
export function MockStatus({ online = true }: { online?: boolean }) {
  return (
    <span className={`status ${online ? "ok" : "bad"}`} role="status">
      <span className="dot" />
      {online ? "Mock server" : "Offline"}
    </span>
  );
}
