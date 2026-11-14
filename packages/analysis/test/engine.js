// Locates the engine checkout the replay tests run against (read-only). Order: BALANCE_FORGE_ENGINE_ROOT, this repo
// root (after the merge), the sibling engine worktree. If none has the recorded runner output, fail loudly.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RECORDED = 'services/runner/recorded-roster-match-results.json';
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const candidates = [process.env.BALANCE_FORGE_ENGINE_ROOT, repoRoot, resolve(repoRoot, '..', 'balance-forge-engine')]
  .filter(Boolean);

export const engineRoot = candidates.find((dir) => existsSync(join(dir, RECORDED)));
if (!engineRoot) {
  throw new Error(`engine checkout with ${RECORDED} not found; tried: ${candidates.join(', ')}. `
    + 'Set BALANCE_FORGE_ENGINE_ROOT.');
}
export const importEngine = (rel) => import(pathToFileURL(join(engineRoot, rel)).href);
export const recordedRosterResults = () => JSON.parse(readFileSync(join(engineRoot, RECORDED), 'utf8'));
