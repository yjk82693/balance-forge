import type { ReactNode } from "react";
import { isMockMode } from "../mock/types";

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

/** Honest status: says which server the page is talking to. */
export function MockStatus({ online = true }: { online?: boolean }) {
  const mock = isMockMode();
  return (
    <span className={`status ${online ? "ok" : "bad"}`} role="status">
      <span className="dot" />
      {online ? (mock ? "Mock server" : "Live server") : mock ? "Offline" : "Reconnecting"}
    </span>
  );
}
