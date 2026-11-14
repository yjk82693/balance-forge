import { readFileSync, writeFileSync } from 'node:fs';
import { rosterJobs, runBatch } from './index.ts';
import { analyzePhase } from '../../packages/analysis/pipeline/pipeline.ts';
import { withExtras } from '../../packages/analysis/src/extras.ts';
import { normalizeIntent } from '../../packages/analysis/src/intent.ts';
const seedsPerMatchup = 100;
const jobs = rosterJobs({ seeds: Array.from({ length: seedsPerMatchup }, (_, index) => index + 1) }),
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
  seedsPerMatchup
};
writeFileSync(new URL('./recorded-roster-match-results.json', import.meta.url), JSON.stringify(results, null,
  2) + '\n');
writeFileSync(new URL('./recorded-roster-metrics.json', import.meta.url), JSON.stringify(details, null, 2) + '\n');
const { report } = analyzePhase(results, {
  reportId: 'r-baseline', botPolicyVersion: details.botPolicyVersion, seedSetId: details.seedSetId,
  // judged against the designer's approved intent (rows get target and deltaToTarget)
  intent: normalizeIntent(JSON.parse(readFileSync(new URL('../room/design/hero_arena-intent.json',
    import.meta.url), 'utf8')))
});
const recordedReport = withExtras(report, {
  elapsedMs: Math.round(details.elapsedMs), recorded: true, createdAt: details.createdAt
});
writeFileSync(new URL('./recorded-roster-report.json', import.meta.url), JSON.stringify(recordedReport,
  null, 2) + '\n');
console.log(JSON.stringify(details));
if (metrics.invalidMatches) process.exitCode = 1;
