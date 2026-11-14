import { REPO_URL, STATIC_BANNER } from "../lib/staticMode";

/** A thin line on every screen of the static build: what the numbers are and where the live system is. */
export function StaticBanner() {
  return (
    <div className="static-banner" role="note">
      {STATIC_BANNER}{" "}
      <a href={REPO_URL} target="_blank" rel="noreferrer">
        (see GitHub)
      </a>
      .
    </div>
  );
}

/** Lobby, arena and phone controller need the room server; the static build says so instead of connecting. */
export function LiveOnly() {
  return (
    <main className="boundary" aria-live="polite">
      <h1 className="h2">This part needs the live server</h1>
      <p className="text-2">
        {STATIC_BANNER}.{" "}
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Run it locally from the repository
        </a>
        .
      </p>
      <a className="btn primary" href="#/dashboard">
        Open the recorded dashboard
      </a>
    </main>
  );
}
