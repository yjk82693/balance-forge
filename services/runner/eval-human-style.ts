// Shows that the human-style bot (cloned-lr-1) plays differently from scripted-0.2.1 on Bari vs Real Armor:
//   node services/runner/eval-human-style.ts [--model services/runner/learned/human-style.json] [--pairs 100]
// Rows: win rate of the first hero (Bari) over `pairs` seeds x both seat orders with Wilson intervals, for scripted
// vs scripted, human-style vs human-style and the two mixed pairings, plus a style summary (how often each attack is
// used, how often it moves, the mean distance to the opponent). Evaluation seeds are 1..pairs. These numbers
// describe a style fitted to a handful of matches; they are not balance numbers and never enter a report.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as arena from '../../packages/games/action/index.ts';
import { makeClonedBot } from '../../packages/games/action/bot-cloned.ts';
import { compareIds } from '../../packages/contracts/index.ts';
import { MAX_TICKS, measureMatchup, scriptedBot, seedRange } from './learn/evaluate.ts';
import { round6 } from './learn/stats.ts';

const HEROES = ['bari', 'real_armor'];

/** How a bot plays: per seat, attacks per 100 ticks, share of ticks it moves, mean distance to the opponent. */
export function styleOf({ botFor, hero, seeds, maxTicks = MAX_TICKS }) {
  const counts = { melee: 0, projectile: 0, guard: 0, moveTicks: 0, ticks: 0, distance: 0 };
  for (const seed of seeds) {
    for (const swap of [false, true]) {
      const seats = swap ? { p1: HEROES[1], p2: HEROES[0] } : { p1: HEROES[0], p2: HEROES[1] };
      const mine = swap ? 'p2' : 'p1';
      const config = arena.makeConfig(arena.data, seed, ['p1', 'p2'], maxTicks, seats);
      config.options = { assignments: seats };
      let state = arena.initial(config, arena.data);
      while (arena.outcome(state).status === 'running') {
        const actions = config.players.flatMap((id, seat) => {
          const bot = botFor(seats[id]);
          return bot.chooseActions(arena.observe(state, id), state.tick * 2, bot.deriveBotSeed(seed, seat));
        }).sort((a, b) => compareIds(a.playerId, b.playerId));
        if (seats[mine] === hero) {
          const me = state.payload.entities.find(e => e.id === mine);
          const enemy = state.payload.entities.find(e => e.id !== mine);
          counts.ticks += 1;
          counts.distance += Math.hypot(enemy.x - me.x, enemy.y - me.y);
          for (const a of actions.filter(x => x.playerId === mine)) {
            if (a.actionId === 'move') {
              if (a.params.moveX || a.params.moveY) counts.moveTicks += 1;
            } else counts[a.actionId] += 1;
          }
        }
        state = arena.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, arena.data).state;
      }
    }
  }
  const per100 = n => round6(n * 100 / counts.ticks);
  return { ticks: counts.ticks, meleePer100Ticks: per100(counts.melee),
    projectilePer100Ticks: per100(counts.projectile), guardPer100Ticks: per100(counts.guard),
    movingShare: round6(counts.moveTicks / counts.ticks),
    meanDistance: Math.round(counts.distance / counts.ticks) };
}

export function evalHumanStyle({ model, pairs = 100 }) {
  const human = makeClonedBot(model);
  const seeds = seedRange(1, pairs);
  const asBots = (a, b) => hero => (hero === HEROES[0] ? a : b);
  const rows = {
    scriptedVsScripted: measureMatchup({ heroes: HEROES, botFor: asBots(scriptedBot, scriptedBot), seeds }),
    humanStyleVsHumanStyle: measureMatchup({ heroes: HEROES, botFor: asBots(human, human), seeds }),
    humanStyleBariVsScriptedRealArmor: measureMatchup({ heroes: HEROES, botFor: asBots(human, scriptedBot), seeds }),
    scriptedBariVsHumanStyleRealArmor: measureMatchup({ heroes: HEROES, botFor: asBots(scriptedBot, human), seeds })
  };
  const first = seeds.slice(0, Math.min(30, seeds.length));
  const style = {
    scripted: styleOf({ botFor: () => scriptedBot, hero: 'bari', seeds: first }),
    humanStyle: styleOf({ botFor: hero => (hero === 'bari' ? human : scriptedBot), hero: 'bari', seeds: first })
  };
  return { matchup: HEROES.join(' vs '), pairs, botPolicyVersions: { scripted: scriptedBot.botPolicyVersion,
    humanStyle: human.botPolicyVersion }, rows, style,
  note: 'A style fitted to a handful of matches; not a balance number, never used in a report.' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) flags[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const path = flags.model ?? fileURLToPath(new URL('./learned/human-style.json', import.meta.url));
  console.log(JSON.stringify(evalHumanStyle({ model: JSON.parse(readFileSync(path, 'utf8')),
    pairs: flags.pairs ? Number(flags.pairs) : 100 }), null, 1));
}
