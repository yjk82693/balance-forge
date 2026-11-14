import { useEffect, useState } from "react";
import type { ConnStatus } from "../mock/types";
import { isMockMode } from "../mock/types";

/** 'connecting' for the first moments, 'unreachable' once the connection has been down for a few seconds. */
export function useServerState(status: ConnStatus, graceMs = 3000): "ok" | "connecting" | "unreachable" {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (status === "online") {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), graceMs);
    return () => clearTimeout(t);
  }, [status, graceMs]);
  if (status === "online") return "ok";
  return late ? "unreachable" : "connecting";
}

interface Props {
  onRetry: () => void;
  compact?: boolean;
}

/** The "server unreachable" state: says what happened, what to do, and offers sample data. */
export function ServerDown({ onRetry, compact }: Props) {
  return (
    <div className={`panel server-down${compact ? " compact" : ""}`} role="alert">
      <p className="eyebrow" style={{ color: "var(--danger)" }}>
        Server unreachable
      </p>
      <h2 className="h3">Can't reach the server.</h2>
      <p className="text-2">Check that it's running, then try again.{isMockMode() ? "" : " You can also look around with sample data."}</p>
      <div className="server-down-actions">
        <button className="btn primary" onClick={onRetry}>
          Try again
        </button>
        {!isMockMode() && (
          <a className="btn secondary" href={`${location.pathname}?mock=1${location.hash}`}>
            Use sample data
          </a>
        )}
      </div>
    </div>
  );
}
