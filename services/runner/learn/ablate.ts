// Same-budget comparison of proposers on one hero: the cross-entropy method, blind mutation, and the LLM coach
// (the coach only runs with GEMINI_API_KEY in the environment; without it the row says "not run", never a stand-in).
//   node services/runner/learn/ablate.js [--hero daewi] [--generations 6] [--population 16] [--workers 2]
// Training seeds are 5,000,001.., the held-out opponent (nightcrow) uses seeds 7,000,001.. as in train.js.
import { fileURLToPath } from 'node:url';
import { cemProposer } from './cem.ts';
import { coachProposer, mutationProposer } from './coach.ts';
import { heldOutEvaluation, trainHero } from './train.ts';

const OPPONENTS = ['real_armor', 'daewi', 'sepia', 'bari'];

/** Resolves one row per proposer: curve (mean per generation), best fitness, held-out win rate and origin. */
export async function ablate({ hero = 'daewi', generations = 6, population = 16, seedsPerOpponent = 5, workers = 2,
  heldOutPairs = 100, seed = 1, env = process.env } = {}) {
  const opponents = OPPONENTS.filter(h => h !== hero);
  const makers = { cem: cemProposer, mutation: mutationProposer,
    ...(env.GEMINI_API_KEY ? { coach: args => coachProposer({ ...args, env }) } : {}) };
  const rows = {};
  for (const [name, makeProposer] of Object.entries(makers)) {
    const run = await trainHero({ hero, opponents, generations, populationSize: population, seedsPerOpponent, seed,
      makeProposer, workers });
    const held = heldOutEvaluation({ hero, heldOutHero: 'nightcrow', params: run.params, population: {},
      pairs: heldOutPairs });
    rows[name] = { origin: run.origin, matches: run.matches, ms: run.ms, bestFitness: run.bestFitness,
      curve: run.curve.map(g => Number(g.mean.toFixed(3))),
      heldOut: { learned: held.learned, defaults: held.defaults } };
  }
  if (!rows.coach) rows.coach = { notRun: 'no GEMINI_API_KEY in this environment' };
  return { hero, generations, population, seedsPerOpponent, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = {};
  for (let i = 2; i < process.argv.length; i += 2) flags[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const num = key => (flags[key] === undefined ? undefined : Number(flags[key]));
  const out = await ablate({ hero: flags.hero, generations: num('generations'), population: num('population'),
    workers: num('workers') });
  console.log(JSON.stringify(out, null, 1));
}
