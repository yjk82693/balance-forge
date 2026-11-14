import type { Envelope } from "../lib/contract";

import { IS_STATIC } from "../lib/staticMode";

export type Role = "display" | "controller" | "observer";
export type ConnStatus = "connecting" | "online" | "lost";

export interface Transport {
  readonly sessionId: string;
  send(type: string, payload: unknown): void;
  subscribe(fn: (env: Envelope) => void): () => void;
  onStatus(fn: (s: ConnStatus) => void): () => void;
  /** Simulate a dropped connection; reconnect() brings it back. */
  drop(): void;
  reconnect(): void;
  close(): void;
}

/** `?mock=1` in the page URL keeps the in-browser mock server; otherwise the real /ws is used. */
export const isMockMode = (): boolean =>
  !IS_STATIC && new URLSearchParams(location.search).get("mock") === "1"; // the static build has no sample mode
