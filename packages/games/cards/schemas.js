import { integer as int, text, array, object, ref } from '../../contracts/shapes.js';
export const card = object({
  id: text(),
  cost: int(0, 3),
  kind: {
    enum: ['damage', 'ward', 'summon', 'hypnosis']
  },
  power: int(0, 100),
  ignoresWard: {
    type: 'boolean'
  }
});
const unit = object({
  id: text(),
  power: int(0, 100),
  sleepUntil: int(0, 12)
});
export const entity = object({
  id: text(),
  hp: int(0, 100),
  energy: int(0, 3),
  ward: int(0, 100),
  hand: array(text(), 5),
  deck: array(text(), 100),
  discard: array(text(), 100),
  units: array(unit, 2),
  lastSeq: int(-1)
});
const visible = object({
  id: text(),
  hp: int(0, 100),
  energy: int(0, 3),
  ward: int(0, 100),
  handCount: int(0, 5),
  deckCount: int(0, 100),
  units: array(unit, 2)
});
export const actions = [{
  actionId: 'play',
  labelKey: 'cards.play',
  control: 'choice',
  paramsSchema: object({
    handIndex: int(0, 4),
    slot: int(0, 1)
  }, ['handIndex'])
}, {
  actionId: 'end_turn',
  labelKey: 'cards.end_turn',
  control: 'button',
  paramsSchema: object({})
}];
export const schemas = {
  ...Object.fromEntries(actions.map(a => [`action:${a.actionId}`, a.paramsSchema])),
  rules: object({
    energy: {
      const: 3
    },
    handSize: {
      const: 5
    },
    summonSlots: {
      const: 2
    },
    rounds: {
      const: 6
    },
    health: int(1, 100),
    cards: array(card, 5, 5)
  }),
  state: object({
    config: ref('MatchConfig'),
    cards: array(card, 5, 5),
    activePlayer: text(),
    round: int(1, 6),
    entities: array(entity, 2, 2),
    nextUnit: int(),
    outcome: ref('Outcome'),
    statistics: ref('Statistics')
  }),
  observation: object({
    activePlayer: text(),
    round: int(1, 6),
    turnId: int(0, 12),
    entities: array(visible, 2, 2),
    hand: array(card, 5),
    outcome: ref('Outcome')
  })
};
