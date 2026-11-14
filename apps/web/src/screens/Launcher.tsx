import { GAMES, type GameInfo } from "../lib/games";
import { HeroPortrait } from "../components/HeroPortrait";
import { MockStatus, TopBar } from "../components/TopBar";
import { manifestUrl, preferWebp, useManifestState } from "../lib/assets";
import { go } from "../lib/router";
import { fixtureReportBaseline } from "../lib/fixtures";

function lastRunLine(g: GameInfo): string {
  if (g.status === "planned") return "Not testable yet";
  if (g.id !== "hero_arena") return "Not run yet";
  // Sample fixture only; labelled so it is never read as a live result.
  const rows = fixtureReportBaseline.rows;
  const top = rows.reduce((a, b) => (b.winRate > a.winRate ? b : a));
  return `Sample report · ${Math.round(top.winRate * 100)}% max · ${top.games.toLocaleString("en-US")} games`;
}

function Tile({ game, loading }: { game: GameInfo; loading: boolean }) {
  const planned = game.status === "planned";
  const art = manifestUrl(preferWebp(game.art));
  const open = () => !planned && go(`/lobby/${game.id}`);
  return (
    <article
      className={`card tile${planned ? " disabled" : ""}`}
      style={{ ["--game" as string]: `var(${game.accentVar})` }}
      onClick={open}
      aria-disabled={planned}
    >
      <div className={`tile-art${loading ? " sk" : ""}`} style={art ? { backgroundImage: `url(${art})` } : undefined}>
        <div className="tile-scrim" />
        <div className="tile-portrait">
          <HeroPortrait hero={game.portraitHero} size={64} />
        </div>
        {planned && <span className="badge planned tile-badge">planned</span>}
      </div>
      <div className="tile-body">
        <p className="eyebrow" style={{ color: "var(--game)" }}>
          {game.eyebrow}
        </p>
        <h2 className="h3">{game.title}</h2>
        <p className="small text-2">{game.summary}</p>
        <p className="small" style={{ color: planned ? "var(--text-3)" : "var(--text-1)" }}>
          {lastRunLine(game)}
        </p>
        {planned ? (
          <button className="btn secondary" aria-disabled="true" onClick={(e) => e.stopPropagation()} tabIndex={-1}>
            Coming soon
          </button>
        ) : (
          <button
            className={`btn ${game.id === "hero_arena" ? "primary" : "secondary"}`}
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          >
            Open lobby
          </button>
        )}
      </div>
    </article>
  );
}

export function Launcher() {
  const ms = useManifestState();
  return (
    <div className="screen">
      <TopBar>
        <span className="spacer" />
        <MockStatus />
      </TopBar>
      <main className="launcher">
        <p className="eyebrow">Bots play · AI patches · You verify</p>
        <h1 className="h1">Pick a game to test</h1>
        <div className="grad-bar" />
        {ms === "failed" && (
          <div className="notice art-failed-note" role="alert">
            <span>Couldn't load the game art. The games still work.</span>
            <button className="btn secondary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        )}
        <div className="tiles">
          {GAMES.map((g) => (
            <Tile key={g.id} game={g} loading={ms === "loading"} />
          ))}
        </div>
      </main>
    </div>
  );
}
