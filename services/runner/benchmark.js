import { writeFileSync } from 'node:fs';
import { rosterJobs, runBatch } from './index.js';
const jobs = rosterJobs(),
  {
    results,
    metrics
  } = await runBatch(jobs, {
    workers: 2
  });
const details = {
  ...metrics,
  gameId: results[0].config.gameId,
  simVersion: results[0].config.simVersion,
  dataHash: results[0].config.dataHash,
  createdAt: new Date().toISOString(),
  matchups: 15,
  includesMirrors: true,
  seedsPerMatchup: 10
};
writeFileSync(new URL('./recorded-roster-match-results.json', import.meta.url), JSON.stringify(results, null,
  2) + '\n');
writeFileSync(new URL('./recorded-roster-metrics.json', import.meta.url), JSON.stringify(details, null, 2) + '\n');
console.log(JSON.stringify(details));
if (metrics.invalidMatches) process.exitCode = 1;
