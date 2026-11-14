// Why does a hero lose a matchup? Replays matches of one pair with the scripted bot in this process (engine modules,
// no server, no network) and reports, from the real simulation: the distance between the heroes over time, how often a
// melee swing is started out of range or in range, and how each swing ends (landed, blocked by a guard, interrupted by
// a stun before it lands, or whiffed). Read-only analysis of recorded behaviour; it changes nothing.
//   node packages/analysis/pipeline/matchup-forensics.js --heroes daewi,real_armor [--seeds 100] [--engine-root dir]
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { errorResult, toErrorResult } from '../src/errors.js';

const emptyTally = () => ({ starts: 0, landed: 0, blocked: 0, interrupted: 0, whiffed: 0 });
const mean = (xs, f) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0);
const round = (x, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;

/** One match, tick by tick: distances, availability of melee, and how every melee swing ended. */
function playOne(engine, heroes, seed, swap) {
  const { arena, chooseActions, deriveBotSeed, compareIds, data } = engine;
  const assignments = swap ? { p1: heroes[1], p2: heroes[0] } : { p1: heroes[0], p2: heroes[1] };
  const config = arena.makeConfig(data, seed, ['p1', 'p2'], 1800, assignments);
  config.options = { assignments };
  let state = arena.initial(config, data);
  const ticks = [];
  const swings = [];
  const started = {};
  while (arena.outcome(state).status === 'running') {
    const view = (id) => arena.observe(state, id);
    const actions = config.players.flatMap((id, i) => chooseActions(view(id), state.tick * 2,
      deriveBotSeed(config.seed, i))).sort((a, b) => compareIds(a.playerId, b.playerId));
    const [first, second] = state.payload.entities;
    const dist = Math.hypot(first.x - second.x, first.y - second.y);
    ticks.push({ tick: state.tick, dist, legal: Object.fromEntries(config.players.map((id) => [id,
      arena.legalActions(view(id)).some((a) => a.actionId === 'melee')])) });
    const step = arena.step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data);
    const tick = state.tick + 1;
    for (const e of step.events) {
      if (e.kind === 'action.used' && e.payload.actionId === 'melee') {
        started[e.payload.playerId] = { tick, dist };
      }
    }
    for (const id of config.players) {
      const was = state.payload.entities.find((e) => e.id === id).pending.actionId;
      const now = step.state.payload.entities.find((e) => e.id === id);
      if (was !== 'melee' || now.pending.actionId !== '') continue;
      const hit = step.events.find((e) => e.kind === 'combat.hit' && e.payload.source === id);
      const outcome = hit ? (hit.payload.guarded ? 'blocked' : 'landed') : now.stunUntil > tick ? 'interrupted'
        : 'whiffed';
      swings.push({ hero: assignments[id], start: started[id]?.tick, resolved: tick, startDist: started[id]?.dist,
        outcome });
    }
    state = step.state;
  }
  const winner = arena.outcome(state).winners[0];
  return { seed, swap, seats: assignments, ticks, swings, winnerHero: assignments[winner], duration: state.tick,
    hp: Object.fromEntries(state.payload.entities.map((e) => [assignments[e.id], e.hp])) };
}

const tallyOf = (matches, hero, keep = () => true) => {
  const t = emptyTally();
  for (const m of matches) {
    for (const s of m.swings) if (s.hero === hero && keep(s)) {
      t.starts += 1;
      t[s.outcome] += 1;
    }
  }
  return t;
};

/** Pure summary of replayed matches (also used by the tests with a stub). */
export function summarize(matches, heroes, meleeRange) {
  const [a, b] = heroes;
  const firstClose = (m) => m.ticks.find((t) => t.dist <= meleeRange)?.tick ?? null;
  const never = matches.filter((m) => firstClose(m) === null);
  const closed = matches.filter((m) => firstClose(m) !== null);
  const wins = (list, hero) => list.filter((m) => m.winnerHero === hero).length;
  const available = (hero) => {
    let within = 0;
    let legal = 0;
    for (const m of matches) {
      const seat = Object.keys(m.seats).find((s) => m.seats[s] === hero);
      for (const t of m.ticks) {
        if (t.dist > meleeRange) continue;
        within += 1;
        if (t.legal[seat]) legal += 1;
      }
    }
    return { ticksWithinMeleeRange: within, meleeAvailable: legal, share: within ? round(legal / within, 3) : 0 };
  };
  const swings = (hero) => ({ all: tallyOf(matches, hero),
    inRange: tallyOf(matches, hero, (s) => s.startDist <= meleeRange),
    outOfRangeStarts: tallyOf(matches, hero, (s) => s.startDist > meleeRange).starts });
  return {
    heroes, meleeRange, matches: matches.length, winRateFirst: round(wins(matches, a) / matches.length, 3),
    neverWithinMeleeRange: { matches: never.length, winsFirst: wins(never, a),
      meanTicks: round(mean(never, (m) => m.duration)) },
    cameWithinMeleeRange: { matches: closed.length, winsFirst: wins(closed, a),
      meanTicks: round(mean(closed, (m) => m.duration)) },
    distanceProfile: Array.from({ length: 12 }, (_, i) => i * 6).map((tick) => ({ tick,
      meanDistance: Math.round(mean(matches.filter((m) => m.ticks[tick]), (m) => m.ticks[tick].dist)) })),
    swings: { [a]: swings(a), [b]: swings(b) }, meleeAvailability: { [a]: available(a), [b]: available(b) },
    meanTicksFromStartToResolve: Object.fromEntries([a, b].map((hero) => [hero,
      round(mean(matches.flatMap((m) => m.swings.filter((s) => s.hero === hero)), (s) => s.resolved - s.start), 2)])),
    firstHeroLosses: matches.filter((m) => m.winnerHero === b).slice(0, 3).map((m) => ({ seed: m.seed, seats: m.seats,
      ticks: m.duration, hp: m.hp, distanceEverySixTicks: m.ticks.filter((t) => t.tick % 6 === 0).slice(0, 14)
        .map((t) => Math.round(t.dist)), firstWithinRange: firstClose(m),
      swings: m.swings.slice(0, 8).map((s) => `${s.hero}@${s.start}:${s.outcome}(${s.resolved - s.start}t)`) })),
  };
}

const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : 'n/a');

/** One or two sentences with the numbers, for the hand-over to a designer. */
export function forensicsSentence(summary) {
  const [a, b] = summary.heroes;
  const sa = summary.swings[a];
  const sb = summary.swings[b];
  const rangeLine = `${summary.neverWithinMeleeRange.matches} of ${summary.matches} replays never came within melee `
    + `range (${summary.meleeRange}); ${a} started ${pct(sa.outOfRangeStarts, sa.all.starts)} of its swings out `
    + 'of range.';
  const swingLine = `In range, ${a}'s swings landed ${pct(sa.inRange.landed, sa.inRange.starts)} (interrupted `
    + `${pct(sa.inRange.interrupted, sa.inRange.starts)}, blocked ${pct(sa.inRange.blocked, sa.inRange.starts)}; `
    + `${summary.meanTicksFromStartToResolve[a]} ticks from start to hit) against ${pct(sb.inRange.landed,
      sb.inRange.starts)} for ${b} (${summary.meanTicksFromStartToResolve[b]} ticks).`;
  return `Replays of ${a} vs ${b}: ${swingLine} ${rangeLine}`;
}

/** Replays `seeds` seeds of heroes[0] vs heroes[1], both seat orders. Resolves { ok, value } or an error result. */
export async function forensics({ heroes, seeds = 100, engineRoot } = {}) {
  try {
    if (!Array.isArray(heroes) || heroes.length !== 2 || heroes[0] === heroes[1]) {
      return errorResult('INVALID_INPUT', 'heroes must be two different hero ids');
    }
    const load = (rel) => import(engineRoot ? pathToFileURL(join(resolve(engineRoot), rel)).href
      : new URL(`../../../${rel}`, import.meta.url).href);
    const [arena, bot, contracts] = await Promise.all([load('packages/games/action/index.js'),
      load('packages/games/action/bot.js'), load('packages/contracts/index.js')]);
    const engine = { arena, chooseActions: bot.chooseActions, deriveBotSeed: bot.deriveBotSeed,
      compareIds: contracts.compareIds, data: arena.data };
    if (heroes.some((h) => !arena.data.characters.some((c) => c.id === h))) {
      return errorResult('INVALID_INPUT', 'unknown hero id');
    }
    const matches = [];
    for (let seed = 1; seed <= seeds; seed++) for (const swap of [false, true]) {
      matches.push(playOne(engine, heroes, seed, swap));
    }
    return { ok: true, value: summarize(matches, heroes, arena.data.gameRules.meleeRange) };
  } catch (e) {
    return e?.code === 'ERR_MODULE_NOT_FOUND' ? errorResult('ENGINE_UNAVAILABLE', 'engine modules not found') :
      toErrorResult(e);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = {};
  for (let i = 2; i < process.argv.length; i += 2) flags[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const result = await forensics({ heroes: String(flags.heroes ?? '').split(','), seeds: Number(flags.seeds ?? 100),
    engineRoot: flags['engine-root'] });
  (result.ok ? console.log : console.error)(JSON.stringify(result.ok ? result.value : result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
