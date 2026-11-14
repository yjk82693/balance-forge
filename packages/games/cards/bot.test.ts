import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cards from './index.ts';
import { chooseAction, deriveBotSeed, botPolicyVersion } from './bot.ts';

function play(seed, decks = ['standard', 'nightcrow'], data = cards.data) {
  const config = { ...cards.makeConfig(data, seed), options: { assignments: { p1: decks[0], p2: decks[1] } } };
  let state = cards.initial(config, data);
  const actions = [];
  while (cards.outcome(state).status === 'running') {
    const id = state.payload.activePlayer;
    const action = chooseAction(cards.observe(state, id), state.tick, deriveBotSeed(seed, config.players.indexOf(id)));
    actions.push(action);
    state = cards.step(state, { tick: state.tick + 1, actions: [action], systemInputs: [] }, data).state;
  }
  return { state, actions };
}

test('the cards bot only plays legal cards: 300 seeds finish (late hypnosis used to break the schema)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { state } = play(seed, seed % 2 ? ['standard', 'nightcrow'] : ['nightcrow', 'standard']);
    assert.notEqual(cards.outcome(state).status, 'running');
  }
  assert.match(botPolicyVersion, /^cards-bot-/);
});

test('the cards bot is deterministic and its seat variants differ', () => {
  assert.deepEqual(play(7).actions, play(7).actions);
  assert.notDeepEqual(play(7).actions, play(8).actions);
});

test('play:<cardId> statistics count each play and each turn a card was playable', () => {
  const { state } = play(11);
  const stats = cards.statistics(state);
  for (const player of stats.players) {
    const byCard = player.actions.filter(a => a.actionId.startsWith('play:'));
    assert.equal(byCard.length, cards.data.gameRules.cards.length);
    assert.equal(byCard.reduce((sum, a) => sum + a.uses, 0), player.actions.find(a => a.actionId === 'play').uses);
    assert.ok(byCard.every(a => a.uses <= a.opportunities));
  }
});
