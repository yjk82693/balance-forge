import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as learned from './bot-learned.ts';
import * as scripted from './bot.ts';
import { data, initial, legalActions, makeConfig, observe, step } from './index.ts';
import { compareIds } from '../../contracts/index.ts';
const { DEFAULT_PARAMS, PARAM_NAMES, PARAM_SPECS } = learned;
const view = (a, b, over = {}) => {
  const config = makeConfig(data, 3, ['p1', 'p2'], 1800, { p1: a, p2: b });
  const state = initial(config, data);
  state.payload.entities[0].x = over.x1 ?? 4200;
  state.payload.entities[1].x = over.x2 ?? 9200;
  state.payload.entities[0].y = state.payload.entities[1].y = 4424;
  return { state, view: observe(state, 'p1') };
};

test('parameters: ranges are checked in code, a bad field falls back to the parent value', () => {
  assert.deepEqual(PARAM_NAMES, ['standOff', 'reaction', 'guardChance', 'meleeClose', 'aggression', 'aimBias',
    'strafePeriod']);
  assert.doesNotThrow(() => learned.validateParams(DEFAULT_PARAMS));
  for (const name of PARAM_NAMES) {
    const { min, max } = PARAM_SPECS[name];
    assert.doesNotThrow(() => learned.validateParams({ ...DEFAULT_PARAMS, [name]: min }));
    assert.doesNotThrow(() => learned.validateParams({ ...DEFAULT_PARAMS, [name]: max }));
    for (const bad of [min - 1, max + 1, 1.5, '5', null, NaN, undefined]) {
      assert.throws(() => learned.validateParams({ ...DEFAULT_PARAMS, [name]: bad }), /INVALID_SCHEMA/,
        `${name}=${bad}`);
    }
  }
  assert.throws(() => learned.validateParams({ ...DEFAULT_PARAMS, extra: 1 }), /INVALID_SCHEMA/);
  assert.throws(() => learned.validateParams(null), /INVALID_SCHEMA/);
  const parent = { ...DEFAULT_PARAMS, standOff: 3000 };
  const { params, fellBack } = learned.sanitizeParams({ standOff: 99999, reaction: 4, guardChance: -3, bogus: 1,
    meleeClose: 1200.5 }, parent);
  assert.deepEqual(params, { standOff: 3000, reaction: 4, guardChance: 75, meleeClose: 1900, aggression: 90,
    aimBias: 0, strafePeriod: 40 });
  assert.deepEqual(fellBack, ['standOff', 'guardChance', 'meleeClose', 'aggression', 'aimBias', 'strafePeriod']);
  assert.doesNotThrow(() => learned.validateParams(params));
  for (const junk of [null, undefined, 'x', [], 5]) {
    assert.deepEqual(learned.sanitizeParams(junk).params, DEFAULT_PARAMS);
  }
});

test('the params hash tags the bot version, is order independent, and changes with any value', () => {
  const a = { bari: { ...DEFAULT_PARAMS }, daewi: { ...DEFAULT_PARAMS, standOff: 1500 } };
  const reordered = { daewi: Object.fromEntries([...PARAM_NAMES].reverse().map(n => [n, a.daewi[n]])), bari: a.bari };
  assert.equal(learned.paramsHash(a), learned.paramsHash(reordered));
  assert.match(learned.policyVersion(a), /^learned-cem-1\+[0-9a-f]{8}$/);
  assert.equal(learned.policyVersion(a), learned.policyVersion(reordered));
  const changed = structuredClone(a);
  changed.bari.aimBias = 1;
  assert.notEqual(learned.policyVersion(changed), learned.policyVersion(a));
  assert.equal(learned.makeLearnedBot(a).botPolicyVersion, learned.policyVersion(a));
});

test('decisions are deterministic, legal, and shaped like the scripted ones', () => {
  const { view: v } = view('bari', 'real_armor');
  const first = learned.decideWith(DEFAULT_PARAMS, v, 10, 77);
  assert.deepEqual(learned.decideWith(DEFAULT_PARAMS, v, 10, 77), first);
  const legal = new Set(legalActions(v).map(a => a.actionId));
  for (const input of first) {
    assert.ok(legal.has(input.actionId));
    assert.deepEqual(Object.keys(input).sort(), ['actionId', 'params', 'playerId', 'seq', 'tick', 'turnId']);
    assert.equal(input.tick, v.tick + 1);
  }
  const display = observe(initial(makeConfig(data, 3), data), 'display');
  assert.deepEqual(learned.decideWith(DEFAULT_PARAMS, display, 0, 0), []);
});

test('each parameter does what it says', () => {
  const far = view('bari', 'real_armor').view; // 5,000 apart
  const moveX = params => learned.decideWith(params, far, 4, 9).find(i => i.actionId === 'move').params.moveX;
  assert.equal(moveX({ ...DEFAULT_PARAMS, standOff: 6000 }), 0); // already inside its stand-off: holds
  assert.equal(moveX({ ...DEFAULT_PARAMS, standOff: 600 }), 1000); // outside it: closes in
  const attacks = params => learned.decideWith(params, far, 4, 9)
    .filter(i => i.actionId === 'melee' || i.actionId === 'projectile');
  assert.equal(attacks({ ...DEFAULT_PARAMS, aggression: 0 }).length, 0); // never attacks
  assert.equal(attacks({ ...DEFAULT_PARAMS, aggression: 100 })[0].actionId, 'projectile');
  const near = view('bari', 'real_armor', { x1: 4200, x2: 5400 }).view; // 1,200 apart
  const meleeAt = params => learned.decideWith(params, near, 4, 9).some(i => i.actionId === 'melee');
  assert.equal(meleeAt({ ...DEFAULT_PARAMS, standOff: 2400, meleeClose: 1900 }), true);
  assert.equal(meleeAt({ ...DEFAULT_PARAMS, standOff: 2400, meleeClose: 800 }), false); // outside its own melee rule
  const aim = bias => learned.decideWith({ ...DEFAULT_PARAMS, aimBias: bias }, far, 4, 9).find(i => i.actionId ===
    'projectile').params;
  assert.equal(aim(0).aimY, 0);
  assert.ok(aim(200).aimY > 0 && aim(-200).aimY < 0); // sideways of a horizontal aim line
  const flips = new Set();
  for (let tick = 0; tick < 400; tick++) {
    const state = view('bari', 'real_armor', { x1: 4200, x2: 5000 }).state;
    state.tick = tick;
    const v = observe(state, 'p1');
    const params = { ...DEFAULT_PARAMS, standOff: 6000, strafePeriod: 8 };
    const move = learned.decideWith(params, v, 1, 4).find(i => i.actionId === 'move');
    if (move) flips.add(`${Math.floor(tick / 8)}:${move.params.moveY}`);
  }
  assert.ok([...flips].some(f => f.endsWith(':1000')) && [...flips].some(f => f.endsWith(':-1000')));
});

test('a guard comes with a high guard chance and an incoming projectile, and not without one', () => {
  const state = view('bari', 'real_armor').state;
  state.payload.projectiles.push({ id: 'pr0', owner: 'p2', kind: 'projectile', x: 5000, y: 4424, vx: -460, vy: 0,
    life: 45, power: 44, moveId: 'projectile', ignoresGuard: false });
  const v = observe(state, 'p1');
  const guarded = params => learned.decideWith(params, v, 4, 11).some(i => i.actionId === 'guard');
  assert.equal(guarded({ ...DEFAULT_PARAMS, guardChance: 100, reaction: 0 }), true);
  assert.equal(guarded({ ...DEFAULT_PARAMS, guardChance: 0 }), false);
});

test('the roster bot uses learned params per hero and the scripted policy for the rest', () => {
  const bot = learned.makeLearnedBot({ bari: { ...DEFAULT_PARAMS, aggression: 0 } });
  const v1 = view('bari', 'real_armor').view;
  const swings = bot.chooseActions(v1, 4, 9).filter(i => i.actionId === 'melee' || i.actionId === 'projectile');
  assert.equal(swings.length, 0); // bari: learned, passive
  const v2 = observe(view('bari', 'real_armor').state, 'p2');
  assert.deepEqual(bot.chooseActions(v2, 4, 9), scripted.chooseActions(v2, 4, 9)); // real_armor: scripted
  assert.equal(bot.deriveBotSeed, scripted.deriveBotSeed);
  assert.throws(() => learned.makeLearnedBot({ bari: { ...DEFAULT_PARAMS, standOff: 1 } }), /INVALID_SCHEMA/);
});

test('whole matches with learned params are deterministic and finish, and the module reads inputs only', () => {
  const bot = learned.makeLearnedBot({ bari: DEFAULT_PARAMS, daewi: { ...DEFAULT_PARAMS, standOff: 1500 },
    real_armor: DEFAULT_PARAMS, sepia: DEFAULT_PARAMS, nightcrow: DEFAULT_PARAMS });
  const play = () => {
    const assignments = { p1: 'bari', p2: 'daewi' };
    const config = makeConfig(data, 4, ['p1', 'p2'], 600, assignments);
    config.options = { assignments };
    let state = initial(config, data);
    while (state.payload.outcome.status === 'running') {
      const actions = config.players.flatMap((id, seat) => bot.chooseActions(observe(state, id), state.tick * 2,
        bot.deriveBotSeed(4, seat))).sort((x, y) => compareIds(x.playerId, y.playerId));
      state = step(state, { tick: state.tick + 1, actions, systemInputs: [] }, data).state;
    }
    return [state.tick, JSON.stringify(state.payload.outcome)];
  };
  assert.deepEqual(play(), play());
  const source = readFileSync(new URL('./bot-learned.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.random|Date\.now|performance\.now|state\.payload|\.rng\b/);
});
