import { hash, validate, validateConfig, validateFrame, registerGame, validateGamePayload,
  compareIds } from '../../contracts/index.js';
import { xorshift32, pinData, assertPinned, emptyStatistics, statisticsDelta, clamp } from '../../sim/index.js';
import { schemas, actions } from './schemas.js';
export { data } from './data.js';
export { hash };
export const simVersion = 'cards-0.1.1';
registerGame('hero_cards', 1, schemas);
export const describe = () => ({
  gameId: 'hero_cards',
  titleKey: 'game.hero_cards',
  mode: 'turn',
  minPlayers: 2,
  maxPlayers: 2,
  actions: structuredClone(actions)
});
export const makeConfig = (data, seed = 1, players = ['p1', 'p2']) => ({
  contractVersion: '0.1',
  schemaVersion: 1,
  gameId: 'hero_cards',
  simVersion,
  dataHash: pinData(data),
  seed,
  players,
  mode: 'turn',
  maxTicks: 180
});
function shuffle(state, deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    state.rng = xorshift32(state.rng);
    const j = state.rng % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function refill(state, e, data) {
  while (e.hand.length < data.gameRules.handSize) {
    if (!e.deck.length) {
      if (!e.discard.length) break;
      e.deck = shuffle(state, e.discard);
      e.discard = [];
    }
    e.hand.push(e.deck.pop());
  }
}
export function initial(config, data) {
  validateConfig(config, data, describe(), simVersion);
  pinData(data);
  const decks = data.gameRules.decks;
  const cardIds = new Set(data.gameRules.cards.map(c => c.id));
  if (cardIds.size !== data.gameRules.cards.length || new Set(decks.map(d =>
    d.id)).size !== decks.length) throw Error('INVALID_SCHEMA');
  for (const deck of decks) if (deck.cardIds.some(id => !cardIds.has(id))) throw Error('INVALID_SCHEMA');
  const assigned = config.options?.assignments ?? Object.fromEntries(config.players.map(id => [id, 'standard']));
  if (Object.values(assigned).some(id => !decks.some(d => d.id === id))) throw Error('INVALID_SCHEMA');
  const state = {
    tick: 0,
    rng: config.seed,
    turnId: 0,
    payload: {
      config: structuredClone(config),
      cards: structuredClone(data.gameRules.cards),
      activePlayer: config.players[0],
      round: 1,
      entities: [...config.players].sort(compareIds).map(id => ({
        id,
        deckId: assigned[id],
        peek: {
          playerId: '',
          cardId: '',
          expiresTurn: 0
        },
        hp: data.gameRules.health,
        energy: 3,
        ward: 0,
        hand: [],
        deck: [],
        discard: [],
        units: [],
        lastSeq: -1
      })),
      nextUnit: 0,
      outcome: {
        status: 'running',
        winners: [],
        reason: 'in_progress'
      },
      statistics: emptyStatistics(config.players, ['play', 'end_turn'])
    }
  };
  for (const e of state.payload.entities) {
    e.deck = shuffle(state, Array.from({
      length: 3
    }, () => decks.find(d => d.id === e.deckId).cardIds).flat());
    refill(state, e, data);
  }
  validateGamePayload('hero_cards', 1, 'state', state.payload);
  return state;
}
export function observe(state, viewerId) {
  const p = state.payload,
    e = p.entities.find(e => e.id === viewerId);
  // Only the viewer's hand is serialized; neither deck order nor private PRNG is exposed.
  const view = {
    tick: state.tick,
    viewerId,
    payload: {
      activePlayer: p.activePlayer,
      round: p.round,
      turnId: state.turnId,
      entities: p.entities.map(e => ({
        id: e.id,
        deckId: e.deckId,
        hp: e.hp,
        energy: e.energy,
        ward: e.ward,
        handCount: e.hand.length,
        deckCount: e.deck.length,
        units: structuredClone(e.units)
      })),
      peek: e && state.turnId < e.peek.expiresTurn ? structuredClone(e.peek) : {
        playerId: '',
        cardId: '',
        expiresTurn: 0
      },
      hand: e ? e.hand.map(id => structuredClone(p.cards.find(c => c.id === id))) : [],
      outcome: structuredClone(p.outcome)
    }
  };
  validate('Observation', view);
  validateGamePayload('hero_cards', 1, 'observation', view.payload);
  return view;
}
function playable(card, e) {
  return card && card.cost <= e.energy && (card.kind !== 'summon' || e.units.length < 2);
}
export function legalActions(view) {
  validateGamePayload('hero_cards', 1, 'observation', view.payload);
  const p = view.payload,
    e = p.entities.find(e => e.id === view.viewerId);
  if (!e || p.activePlayer !== view.viewerId || p.outcome.status !== 'running') return [];
  const result = [structuredClone(actions[1])],
    indices = p.hand.map((c, i) => playable(c, e) ? i : -1).filter(i => i >= 0);
  if (indices.length) {
    const spec = structuredClone(actions[0]);
    spec.paramsSchema.properties.handIndex.enum = indices;
    result.unshift(spec);
  }
  return result;
}
export const outcome = state => structuredClone(state.payload.outcome);
export const statistics = state => structuredClone(state.payload.statistics);
export function step(state, frame, data) {
  assertPinned(state, data);
  if (hash(state.payload.cards) !== hash(data.gameRules.cards)) throw Error('HASH_MISMATCH');
  if (state.payload.outcome.status !== 'running') throw Error('ILLEGAL_ACTION');
  const p = state.payload,
    active = p.entities.find(e => e.id === p.activePlayer);
  validateFrame(state, frame, p.config.players, actions, a => {
    const card = data.gameRules.cards.find(c => c.id === active.hand[a.params.handIndex]);
    return a.playerId === active.id && a.seq > active.lastSeq && (a.actionId === 'end_turn' || playable(card,
      active) && (card.kind !== 'summon' || a.params.slot === active.units.length));
  });
  const timeouts = frame.systemInputs;
  if (timeouts.length > 1 || timeouts.some(t => t.playerId !== active.id) ||
    frame.actions.length + timeouts.length !== 1) throw Error('ILLEGAL_ACTION');
  const next = structuredClone(state),
    q = next.payload,
    e = q.entities.find(x => x.id === active.id),
    enemy = q.entities.find(x => x.id !== active.id),
    events = [];
  next.tick = frame.tick;
  const event = (kind, payload) => events.push({
    eventId: `${next.tick}:${events.length}`,
    audience: [],
    kind,
    payload
  });
  const s = q.statistics.players.find(x => x.playerId === e.id);
  for (const spec of legalActions(observe(state, e.id))) s.actions.find(a =>
    a.actionId === spec.actionId).opportunities++;
  const action = frame.actions[0];
  const damage = (amount, ignoresWard = false) => {
    const absorbed = ignoresWard ? 0 : Math.min(amount, enemy.ward);
    enemy.ward -= absorbed;
    const dealt = clamp(amount - absorbed, 0, enemy.hp);
    enemy.hp -= dealt;
    s.damage += dealt;
    return dealt;
  };
  if (action) {
    e.lastSeq = action.seq;
    s.actions.find(a => a.actionId === action.actionId).uses++;
    if (action.actionId === 'play') {
      const [id] = e.hand.splice(action.params.handIndex, 1),
        card = data.gameRules.cards.find(c => c.id === id);
      e.discard.push(id);
      e.energy -= card.cost;
      if (card.kind === 'summon') e.units.push({
        id: `u${q.nextUnit++}`,
        kind: card.id,
        power: card.power,
        sleepUntil: 0
      });else if (card.kind === 'peek') {
        e.peek = {
          playerId: enemy.id,
          cardId: enemy.deck.at(-1) ?? '',
          expiresTurn: state.turnId + 1
        };
        events.push({
          eventId: `${next.tick}:${events.length}`,
          audience: [e.id],
          kind: 'card.peek',
          payload: {
            ...e.peek
          }
        });
      } else if (card.kind === 'ward') e.ward = clamp(e.ward + card.power, 0, 100);else {
        const amount = damage(card.power, card.ignoresWard);
        if (card.kind === 'hypnosis') for (const unit of enemy.units) unit.sleepUntil = state.turnId + 2;
        event('card.hit', {
          source: e.id,
          target: enemy.id,
          amount,
          ignoresWard: card.ignoresWard
        });
      }
      // Public event names the played card; discarded/remaining hand order stays private.
      event('card.played', {
        playerId: e.id,
        cardId: id
      });
    }
  }
  const endsTurn = !action || action.actionId === 'end_turn' || e.energy === 0;
  if (endsTurn) {
    for (const unit of e.units) if (unit.sleepUntil <= state.turnId) damage(unit.power);
    next.turnId++;
    event(timeouts.length ? 'turn.timeout' : 'turn.ended', {
      playerId: e.id,
      turnId: state.turnId
    });
    if (next.turnId < 12) {
      q.activePlayer = p.config.players[next.turnId % 2];
      q.round = Math.floor(next.turnId / 2) + 1;
      const incoming = q.entities.find(x => x.id === q.activePlayer);
      incoming.energy = 3;
      refill(next, incoming, data);
    }
  }
  if (enemy.hp === 0) q.outcome = {
    status: 'win',
    winners: [e.id],
    reason: 'hp_zero'
  };else if (next.turnId >= 12 || next.tick >= q.config.maxTicks) {
    const top = Math.max(...q.entities.map(x => x.hp)),
      winners = q.entities.filter(x => x.hp === top).map(x => x.id),
      reason = next.turnId >= 12 ? 'six_rounds' : 'max_ticks';
    q.outcome = winners.length === 1 ? {
      status: 'win',
      winners,
      reason
    } : {
      status: 'draw',
      winners: [],
      reason
    };
  }
  q.statistics.durationTicks = next.tick;
  if (q.outcome.status !== 'running') for (const s of q.statistics.players) {
    s.wins = q.outcome.winners.includes(s.playerId) ? 1 : 0;
    s.draws = q.outcome.status === 'draw' ? 1 : 0;
  }
  return {
    state: next,
    events,
    outcome: outcome(next),
    statisticsDelta: statisticsDelta(p.statistics, q.statistics)
  };
}
export const adapter = {
  describe,
  initial,
  observe,
  legalActions,
  step,
  outcome,
  statistics,
  hash
};
