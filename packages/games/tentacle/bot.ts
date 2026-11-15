// Scripted solo bot for the Sepia Tentacle Run wire runner (policy tentacle-bot-0.2.0). Inputs only: observation in,
// the `control` action out, deterministic given (observation, variant). The seed variant gives a personality per run:
//   sloppiness: the chance (per mille) that it ignores an obstacle completely;
//   jitter: how many ticks early or late it acts, per obstacle (a fixed draw per obstacle id, so it does not flicker).
import { xorshift32 } from '../../sim/index.ts';
import { deriveBotSeed } from '../action/bot.ts';
import type { ActionInput, Observation, TentacleObservationPayload } from '../../contracts/types.ts';
export { deriveBotSeed };
export const botPolicyVersion = 'tentacle-bot-0.2.0';

const PLAYER_HALF = 300;
const PIT_WIDTH = 1400;
const AIR_TICKS = 64; // 2 * jumpVelocity / gravity of the data
const TAP_TICKS = 3;
const SLIDE_LEAD_TICKS = 6;
const WALL_LEAD = 1900; // distance from the wall at which the bot jumps to take the wire
const RELEASE_PAST = 300;

function personality(variant: number) {
  let rng = (variant >>> 0) || 1;
  const draw = (m: number) => {
    rng = xorshift32(rng);
    return rng % m;
  };
  return { sloppiness: draw(18), jitter: 1 + draw(5), salt: draw(1000003) + 1 };
}
const hashOf = (salt: number, id: string): number => {
  let h = salt >>> 0 || 1;
  for (let i = 0; i < id.length; i++) h = xorshift32(((h ^ id.charCodeAt(i)) >>> 0) || 1);
  return h;
};

export function chooseActions(view: Observation, seq: number, variant = 0): ActionInput[] {
  const p = view.payload as TentacleObservationPayload;
  if (p.outcome.status !== 'running') return [];
  const me = p.player;
  const { sloppiness, jitter, salt } = personality(variant);
  const speed = Math.max(1, me.vx);
  let jump = 0, slide = 0;

  // the nearest obstacle that is still ahead (or under us) and that the bot has not decided to ignore
  const ahead = p.obstacles.filter(o => o.x + o.w > me.x - PLAYER_HALF - 200)
    .filter(o => hashOf(salt, o.id) % 1000 >= sloppiness).sort((a, b) => a.x - b.x);
  const o = ahead[0];
  const shift = o ? ((hashOf(salt, `${o.id}:j`) % (2 * jitter + 1)) - jitter) * speed : 0;

  if (me.state === 'swinging') {
    jump = 1;
    const wall = p.obstacles.filter(w => w.kind === 'wall' && w.x + w.w > me.x - PLAYER_HALF - 600)
      .sort((a, b) => a.x - b.x)[0];
    const releaseX = wall ? wall.x + wall.w + PLAYER_HALF + RELEASE_PAST : me.wire.anchorX + 1200;
    // let go once Sepia is past the anchor and rising (the best forward momentum), or when she is clear of the wall
    if (me.x >= releaseX || (me.x >= me.wire.anchorX && me.vy >= 0)) jump = 0;
  } else if (o) {
    const front = o.x - (me.x + PLAYER_HALF) - shift;
    if (o.kind === 'pit') {
      const lead = Math.trunc((AIR_TICKS * speed - PIT_WIDTH) / 2);
      const dc = o.x - me.x - shift;
      if (me.state === 'running' && dc <= lead && dc > -400) jump = 1;
      else if (me.jumpHeldTicks > 0 && me.jumpHeldTicks < TAP_TICKS) jump = 1;
    } else if (o.kind === 'lowBar') {
      if (front <= speed * SLIDE_LEAD_TICKS && me.x - PLAYER_HALF < o.x + o.w + 100) slide = 1;
    } else if (o.kind === 'wall') {
      if (me.state === 'running' && front <= WALL_LEAD) jump = 1;
      else if (me.state === 'jumping' && front <= WALL_LEAD + 800) jump = 1; // keep holding to reach the anchor
    }
  }
  return [{ playerId: view.viewerId, seq, tick: view.tick + 1, turnId: 0, actionId: 'control',
    params: { jump, slide } }];
}
