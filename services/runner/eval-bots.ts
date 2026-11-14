// Measures a matchup side by side with the scripted 0.2.1 bots and the learned bots, in this process:
//   node services/runner/eval-bots.js --heroes bari,real_armor [--pairs 100] [--learned-dir dir]
//   node services/runner/eval-bots.js --table [--pairs 100]          (the main matchups)
// Rows: scripted vs scripted, learned vs learned, and the two mixed pairings, each as the first hero's win rate over
// `pairs` seeds x both seat orders with a Wilson 95% interval. Evaluation seeds are 1..pairs, disjoint from the
// training seeds (5,000,001..) and the held-out seeds (7,000,001..). A hero without learned parameters plays the
// scripted policy in the learned rows, and the output says which heroes have learned parameters.
import { fileURLToPath } from 'node:url';
import * as arena from '../../packages/games/action/index.ts';
import { makeLearnedBot } from '../../packages/games/action/bot-learned.ts';
import { assertDisjoint, MAX_TICKS, measureMatchup, scriptedBot, seedRange,
  TRAIN_SEED_BASE } from './learn/evaluate.ts';
import { learnedDir, readLearned } from './learn/load.ts';

export const MAIN_MATCHUPS = Object.freeze([['bari', 'real_armor'], ['bari', 'daewi'], ['daewi', 'real_armor'],
  ['bari', 'sepia'], ['nightcrow', 'real_armor']]);

/** One matchup: the four bot pairings, with the learned parameters read from `dir`. Throws on bad input. */
export function evalMatchup({ heroes, pairs = 100, dir = learnedDir(), maxTicks = MAX_TICKS }) {
  const roster = arena.data.characters.map(c => c.id);
  if (!Array.isArray(heroes) || heroes.length !== 2 || heroes.some(h => !roster.includes(h))) {
    throw Error('INVALID_SCHEMA');
  }
  if (!Number.isInteger(pairs) || pairs < 1 || pairs > 1000) throw Error('INVALID_SCHEMA');
  const seeds = seedRange(1, pairs);
  assertDisjoint(seeds, seedRange(TRAIN_SEED_BASE, 1000), 'evaluation and training seeds');
  const { paramsByHero, skipped } = readLearned(dir);
  const learned = Object.keys(paramsByHero).length ? makeLearnedBot(paramsByHero) : null;
  const [a, b] = heroes;
  const run = botFor => measureMatchup({ heroes, botFor, seeds, maxTicks });
  const rows: Record<string, any> = { scriptedVsScripted: run(() => scriptedBot) };
  if (learned) {
    rows.learnedVsLearned = run(() => learned);
    rows.learnedFirstVsScripted = run(h => (h === a ? learned : scriptedBot));
    rows.scriptedFirstVsLearned = run(h => (h === b ? learned : scriptedBot));
  }
  return { matchup: [...heroes].sort().join(' vs '), first: [...heroes].sort()[0], pairs,
    learnedHeroes: Object.keys(paramsByHero).sort(), learnedVersion: learned?.botPolicyVersion ?? null,
    skipped, scriptedVersion: scriptedBot.botPolicyVersion, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags: Record<string, string | true> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    flags[process.argv[i].replace(/^--/, '')] = process.argv[i + 1] ?? true;
  }
  try {
    const pairs = flags.pairs === undefined ? 100 : Number(flags.pairs);
    const dir = String(flags['learned-dir'] ?? learnedDir());
    const list = flags.table !== undefined ? MAIN_MATCHUPS : [String(flags.heroes ?? '').split(',')];
    console.log(JSON.stringify(list.map(heroes => evalMatchup({ heroes, pairs, dir })), null, 1));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error.message).slice(0, 200) }));
    process.exitCode = 1;
  }
}
