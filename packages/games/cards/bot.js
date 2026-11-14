// Hero Cards bot: plays only legal cards, with seeded preferences, so a roster run covers different play styles
// instead of one fixed order. Same rules as the Hero Arena bot: inputs only, no state access, deterministic.
//   chooseAction(view, seq, variant) -> one ActionInput; variant = deriveBotSeed(matchSeed, seatIndex) per seat.
// Each seat gets one style per match from its variant: 0 = attacker (damage and hypnosis first), 1 = defender
// (ward and summons first), 2 = no preference. With the style's pick 70% of the time, otherwise a uniformly random
// legal card; 8% of turns end early even with a playable card (a player who holds back).
import { xorshift32 } from '../../sim/index.js';
import { deriveBotSeed } from '../action/bot.js';
export { deriveBotSeed };
export const botPolicyVersion = 'cards-bot-0.1.0';

const STYLES = [
  { damage: 0, hypnosis: 1, summon: 2, ward: 3, peek: 4 },
  { ward: 0, summon: 1, damage: 2, hypnosis: 3, peek: 4 },
  null
];
const FOLLOW_PERMILLE = 700;
const HOLD_BACK_PERMILLE = 80;

export function chooseAction(view, seq, variant) {
  const p = view.payload,
    e = p.entities.find(x => x.id === view.viewerId);
  const base = { playerId: view.viewerId, seq, tick: view.tick + 1, turnId: p.turnId };
  const playable = p.hand.map((card, index) => ({ card, index })).filter(({ card }) => card.cost <= e.energy &&
    (card.kind !== 'summon' || e.units.length < 2));
  let rng = xorshift32((((variant >>> 0) ^ Math.imul(p.turnId + 1, 0x9e3779b1) ^ Math.imul(e.energy + 1, 0x85ebca6b)
    ^ Math.imul(playable.length + 1, 0xc2b2ae35)) >>> 0) || 1);
  const roll = modulus => {
    rng = xorshift32(rng);
    return rng % modulus;
  };
  const hold = roll(1000) < HOLD_BACK_PERMILLE;
  if (!playable.length || hold) return { ...base, actionId: 'end_turn', params: {} };
  const style = STYLES[(variant >>> 0) % STYLES.length];
  let pick;
  if (style && roll(1000) < FOLLOW_PERMILLE) {
    pick = [...playable].sort((a, b) => style[a.card.kind] - style[b.card.kind] || a.index - b.index)[0];
  } else pick = playable[roll(playable.length)];
  return { ...base, actionId: 'play', params: { handIndex: pick.index,
    ...(pick.card.kind === 'summon' ? { slot: e.units.length } : {}) } };
}
