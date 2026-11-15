import { IS_STATIC } from "./staticMode.ts";

/** The entry script of a page ("assets/index-<hash>.js"), from its HTML. */
export const entryScript = (html: string): string | null => /assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null;

/** True when the server's page has another entry script than the one this tab runs (a new build was deployed). */
export function isNewBuild(serverHtml: string, mine: string | null): boolean {
  const theirs = entryScript(serverHtml);
  return !!mine && !!theirs && !mine.endsWith(theirs);
}

/**
 * A tab that was open before the server was rebuilt keeps running the old page. Reload it when the build changed, when
 * the tab comes back to the front and every minute, but never in the middle of a match (phone or big screen).
 */
export function watchForNewBuild() {
  if (IS_STATIC || import.meta.env?.DEV) return;
  const mine = document.querySelector('script[type="module"][src*="assets/index-"]')?.getAttribute("src") ?? null;
  const check = async () => {
    if (/^#\/(play|arena)/.test(location.hash)) return;
    try {
      const res = await fetch(location.pathname, { cache: "no-store" });
      if (isNewBuild(await res.text(), mine)) location.reload();
    } catch {
      /* no server or offline: nothing to compare */
    }
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void check());
  setInterval(() => void check(), 60_000);
}
