import type { PlaytestRun } from "./api";
import { runFromFull } from "./fullRun";
import { staticRaw } from "./staticRaw";

const stored = import.meta.glob("../../../../services/runner/recorded-{roster-report,auto-history,full-run}.json", {
  import: "default",
});
const file = (name: string) =>
  Object.entries(stored).find(([path]) => path.endsWith(`/${name}`))?.[1] as (() => Promise<unknown>) | undefined;

/** The static demo's result: a recorded full run, else the recorded roster with the recorded patch and verdict. */
export async function loadStaticRun(): Promise<PlaytestRun | null> {
  // A whole recorded /full response (recorded-full-run.json), when the repository has one, is the result as it was.
  const full = file("recorded-full-run.json");
  if (full) {
    const run = runFromFull(await full());
    if (run) return { ...run, baseline: { ...run.baseline, recorded: true } };
  }
  const [roster, history] = [file("recorded-roster-report.json"), file("recorded-auto-history.json")];
  if (!roster) return null;
  const raw = staticRaw(
    (await roster()) as Record<string, unknown>,
    ((await history?.()) ?? {}) as Record<string, unknown>,
  );
  const run = runFromFull(raw);
  return run ? { ...run, baseline: { ...run.baseline, recorded: true } } : null;
}
