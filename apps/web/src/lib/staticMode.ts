/**
 * The static build (VITE_STATIC=1, `npm run build:static`): a public "Try it" page with no server. It never opens /ws
 * or calls /v1, and shows only the committed recorded data (no sample data, no mock mode).
 */
export const IS_STATIC: boolean = import.meta.env?.VITE_STATIC === "1";

export const REPO_URL = "https://github.com/yjk82693/balance-forge";

export const STATIC_BANNER = "Recorded demo: real results from the live system. Live phone play needs the local server";

/** The browser requests a static build refuses to make: anything for the room server (/v1/..., /ws). */
export function isServerRequest(url: string): boolean {
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
  return /^\/?(v1\/|ws(\/|$))/.test(path) || /^\.\/(v1\/|ws(\/|$))/.test(path);
}

/** Installs the guards of the static build: server requests answer "absent" (404) and no WebSocket is ever opened. */
export function installStaticGuards() {
  if (!IS_STATIC) return;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return isServerRequest(url)
      ? Promise.resolve(new Response("{}", { status: 404, headers: { "content-type": "application/json" } }))
      : real(input, init);
  };
  // The code that would open /ws never runs in this build; if anything tries, it fails closed.
  window.WebSocket = class {
    constructor() {
      throw new Error("The static demo has no server connection.");
    }
  } as unknown as typeof WebSocket;
}
