import { deepFreeze } from '../../sim/index.ts';
// Original event rules. Six rounds: one resolved turn per seat per round.
export const data = deepFreeze({
  v: 1,
  gameId: 'hero_cards',
  characters: [],
  moves: [],
  weightTiers: Array.from({
    length: 4
  }, () => ({
    startupTicks: 0,
    recoveryTicks: 0,
    cooldownTicks: 0,
    stunTicks: 0,
    knockback: 0,
    hitStopTicks: 0
  })),
  tuning: {
    damageScalePermille: 1000
  },
  gameRules: {
    energy: 3,
    handSize: 5,
    summonSlots: 2,
    rounds: 6,
    health: 20,
    cards: [{
      id: 'spark',
      cost: 1,
      kind: 'damage',
      power: 3,
      ignoresWard: false
    }, {
      id: 'ward',
      cost: 1,
      kind: 'ward',
      power: 5,
      ignoresWard: false
    }, {
      id: 'sentinel',
      cost: 2,
      kind: 'summon',
      power: 2,
      ignoresWard: false
    }, {
      id: 'hypnosis',
      cost: 2,
      kind: 'hypnosis',
      power: 4,
      ignoresWard: true
    }, {
      id: 'pulse',
      cost: 1,
      kind: 'damage',
      power: 2,
      ignoresWard: false
    }, {
      id: 'mechanical_crows',
      cost: 2,
      kind: 'summon',
      power: 2,
      ignoresWard: false
    }, {
      id: 'forethought',
      cost: 1,
      kind: 'peek',
      power: 0,
      ignoresWard: false
    }],
    decks: [{
      id: 'standard',
      cardIds: ['spark', 'ward', 'sentinel', 'hypnosis', 'pulse']
    }, {
      id: 'nightcrow',
      cardIds: ['spark', 'ward', 'mechanical_crows', 'hypnosis', 'forethought']
    }]
  },
  provenance: [{
    authorKey: 'balance_forge',
    licenseKey: 'original_event',
    source: 'original-event-content',
    noticeKey: 'content.original'
  }]
});
