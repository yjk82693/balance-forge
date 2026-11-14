// Side-by-side measurement of bot policies on the roster, in this process (engine modules, no server, no network):
//   node packages/analysis/pipeline/bot-compare.js --pairs 100 [--heroes a,b,c] [--engine-root dir]
// For every bot policy it plays each hero pair (mirrors too) with `pairs` seeds in both seat orders and reports
//   - per matchup: games, wins of the first hero (alphabetical) with a Wilson 95% interval (mirrors: seat p1 wins),
//   - per hero: melee swings started, how they ended, the whiff rate (swings that hit nothing) and the share started
//     out of reach,
//   - the share of ticks the heroes spent within melee range, per policy and per matchup.
// It is a long batch at 100 pairs (about 9,000 matches per policy for five heroes); run it on mains power.
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { errorResult, toErrorResult } from '../src/errors.ts';
import { wilson95, round6 } from '../src/wilson.ts';
import { playOne } from './matchup-forensics.ts';

export const POLICIES = [
  { name: 'scripted-0.2.1', file: 'packages/games/action/bot.ts' },
  { name: 'scripted-0.2.2', file: 'packages/games/action/bot-0.2.2.ts' },
  { name: 'scripted-0.2.2b', file: 'packages/games/action/bot-0.2.2b.ts' },
];

const emptyTally = () => ({ starts: 0, landed: 0, blocked: 0, interrupted: 0, whiffed: 0, outOfRangeStarts: 0 });

/** Folds one played match into the running totals (the tick log is dropped afterwards). */
export function addMatch(totals, match, meleeRange) {
  const heroes = [...new Set(Object.values(match.seats))].sort();
  const mirror = heroes.length === 1;
  const dimension = mirror ? `${heroes[0]} vs ${heroes[0]}` : heroes.join(' vs ');
  const cell = totals.matchups.get(dimension) ?? { games: 0, wins: 0, ticks: 0, inRangeTicks: 0 };
  totals.matchups.set(dimension, cell);
  cell.games += 1;
  // First hero (alphabetical) wins; in a mirror the first seat wins. A draw is a game without a win.
  if (match.winner && (mirror ? match.winner === 'p1' : match.winnerHero === heroes[0])) cell.wins += 1;
  cell.ticks += match.ticks.length;
  cell.inRangeTicks += match.ticks.filter((t) => t.dist <= meleeRange).length;
  for (const swing of match.swings) {
    const t = totals.heroes.get(swing.hero) ?? emptyTally();
    totals.heroes.set(swing.hero, t);
    t.starts += 1;
    t[swing.outcome] += 1;
    if (swing.startDist > meleeRange) t.outOfRangeStarts += 1;
  }
}

/** Turns the running totals into the report for one policy. */
export function reportOf(name, totals) {
  const matchups = [...totals.matchups.keys()].sort().map((dimension) => {
    const c = totals.matchups.get(dimension);
    return { dimension, games: c.games, winsFirst: c.wins, winRate: round6(c.wins / c.games),
      ci95: wilson95(c.wins, c.games), shareOfTicksWithinMeleeRange: round6(c.inRangeTicks / c.ticks) };
  });
  const heroes = [...totals.heroes.keys()].sort().map((hero) => {
    const t = totals.heroes.get(hero);
    return { hero, ...t, whiffRate: t.starts ? round6(t.whiffed / t.starts) : null,
      outOfRangeShare: t.starts ? round6(t.outOfRangeStarts / t.starts) : null };
  });
  const all = [...totals.matchups.values()];
  const ticks = all.reduce((n, c) => n + c.ticks, 0);
  return { policy: name, matchups, heroes,
    shareOfTicksWithinMeleeRange: ticks ? round6(all.reduce((n, c) => n + c.inRangeTicks, 0) / ticks) : null };
}

/** Runs every policy on the roster. Resolves { ok: true, value: { pairs, policies: [...] } } or an error result. */
export async function compareBots({ pairs = 100, heroes, engineRoot, policies = POLICIES }: any = {}) {
  try {
    if (!Number.isInteger(pairs) || pairs < 1 || pairs > 1000) {
      return errorResult('INVALID_INPUT', 'pairs must be 1..1000');
    }
    const load = (rel) => import(engineRoot ? pathToFileURL(join(resolve(engineRoot), rel)).href
      : new URL(`../../../${rel}`, import.meta.url).href);
    const [arena, contracts] = await Promise.all([load('packages/games/action/index.ts'),
      load('packages/contracts/index.ts')]);
    const roster = (heroes ?? arena.data.characters.map((c) => c.id)).slice().sort();
    if (roster.some((h) => !arena.data.characters.some((c) => c.id === h))) {
      return errorResult('INVALID_INPUT', 'unknown hero id');
    }
    const meleeRange = arena.data.gameRules.meleeRange;
    const reports = [];
    for (const policy of policies) {
      const bot = await load(policy.file);
      const engine = { arena, chooseActions: bot.chooseActions, deriveBotSeed: bot.deriveBotSeed,
        compareIds: contracts.compareIds, data: arena.data };
      const totals = { matchups: new Map(), heroes: new Map() };
      for (let i = 0; i < roster.length; i++) {
        for (let j = i; j < roster.length; j++) {
          for (let seed = 1; seed <= pairs; seed++) {
            for (const swap of i === j ? [false] : [false, true]) {
              addMatch(totals, playOne(engine, [roster[i], roster[j]], seed, swap), meleeRange);
            }
          }
        }
      }
      reports.push({ ...reportOf(bot.botPolicyVersion ?? policy.name, totals), file: policy.file });
    }
    return { ok: true, value: { pairs, roster, meleeRange, policies: reports } };
  } catch (e) {
    return e?.code === 'ERR_MODULE_NOT_FOUND' ? errorResult('ENGINE_UNAVAILABLE', 'engine modules not found') :
      toErrorResult(e);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags: any = {};
  for (let i = 2; i < process.argv.length; i += 2) flags[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const result: any = await compareBots({ pairs: Number(flags.pairs ?? 100),
    heroes: flags.heroes ? flags.heroes.split(',') : undefined, engineRoot: flags['engine-root'] });
  (result.ok ? console.log : console.error)(JSON.stringify(result.ok ? result.value : result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
