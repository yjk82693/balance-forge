// Scripted solo bot for Sepia Tentacle Run (policy tentacle-bot-0.1.0). Inputs only: observation in, ActionInputs out,
// deterministic given (observation, seq, variant). The seed variant gives it a personality per run:
//   aggression 0..99: how close it likes to fight (high = in whip range, low = kites from far away);
//   latchBias 0..99: how readily it uses the tentacle to dodge incoming shots.
import { xorshift32 } from '../../sim/index.ts';
import { deriveBotSeed } from '../action/bot.ts';
import type { ActionInput, Observation, TentacleObservationPayload } from '../../contracts/types.ts';
export { deriveBotSeed };
export const botPolicyVersion = 'tentacle-bot-0.1.0';

const isqrt = (n: number): number => Math.floor(Math.sqrt(n)); // decisions only, never state
function personality(variant: number) {
  let rng = (variant >>> 0) || 1;
  const draw = (m: number) => {
    rng = xorshift32(rng);
    return rng % m;
  };
  return { aggression: 30 + draw(70), latchBias: draw(100) };
}
const unit = (dx: number, dy: number, n = 1000): [number, number] => {
  const d = isqrt(dx * dx + dy * dy) || 1;
  return [Math.trunc(dx * n / d) || 0, Math.trunc(dy * n / d) || 0]; // never -0 (the schema refuses it)
};

export function chooseActions(view: Observation, seq: number, variant = 0): ActionInput[] {
  const p = view.payload as TentacleObservationPayload;
  if (p.outcome.status !== 'running') return [];
  const [me, ...others] = p.entities;
  const tick = view.tick + 1;
  const { aggression, latchBias } = personality(variant);
  const base = { playerId: view.viewerId, tick, turnId: 0 };
  const out: ActionInput[] = [];
  const enemies = others.filter(e => e.hp > 0);
  const latchReady = me.latchReadyTick <= tick && !me.latch;

  // nearest enemy
  let target = null, targetD2 = Infinity;
  for (const e of enemies) {
    const d2 = (e.x - me.x) ** 2 + (e.y - me.y) ** 2;
    if (d2 < targetD2) {
      target = e;
      targetD2 = d2;
    }
  }
  // incoming shot: the closest approach within 30 ticks
  let danger = null;
  for (const shot of p.projectiles) {
    for (let t = 1; t <= 30 && t <= shot.life; t++) {
      const dx = shot.x + shot.vx * t - me.x, dy = shot.y + shot.vy * t - me.y;
      if (dx * dx + dy * dy <= 900 * 900) {
        danger = { shot, t };
        break;
      }
    }
    if (danger) break;
  }
  const rollBase = ((variant >>> 0) ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0 || 1;
  const roll = xorshift32(xorshift32(rollBase)) % 100;

  let attack: ActionInput | null = null;
  if (danger && latchReady && !me.latch && roll < latchBias + 30) {
    // latch to the post that is farthest from the shot's line, within range
    let best = null, bestScore = -1;
    for (const post of p.posts) {
      const dx = post.x - me.x, dy = post.y - me.y, d2 = dx * dx + dy * dy;
      if (d2 === 0 || d2 > 7000 * 7000) continue;
      const sx = danger.shot.x + danger.shot.vx * danger.t - post.x;
      const sy = danger.shot.y + danger.shot.vy * danger.t - post.y;
      const score = sx * sx + sy * sy;
      if (score > bestScore) {
        best = post;
        bestScore = score;
      }
    }
    if (best) {
      const [ax, ay] = unit(best.x - me.x, best.y - me.y);
      attack = { ...base, seq: seq + 1, actionId: 'latch', params: { aimX: ax, aimY: ay } };
    }
  }
  if (!attack && target && targetD2 <= 2000 * 2000 && me.whipReadyTick <= tick) {
    const [ax, ay] = unit(target.x - me.x, target.y - me.y);
    attack = { ...base, seq: seq + 1, actionId: 'whip', params: { aimX: ax || 1, aimY: ay } };
  }

  // movement: close in to the preferred distance, step off sentry lines, dodge sideways when a shot comes
  let mx = 0, my = 0;
  if (target) {
    const want = 1000 + (100 - aggression) * 6; // 1000..1420: inside whip range (2200), outside contact (900)
    const d = isqrt(targetD2);
    const [ux, uy] = unit(target.x - me.x, target.y - me.y);
    if (d > want + 200) [mx, my] = [ux, uy];
    else if (d < 900 && target.kind !== 'sentry') [mx, my] = [-ux, -uy];
    // step off the line of any sentry that can see us
    for (const e of enemies.filter(x => x.kind === 'sentry')) {
      const dx = me.x - e.x, dy = me.y - e.y;
      if (Math.abs(dx) <= 900 || Math.abs(dy) <= 900) {
        [mx, my] = Math.abs(dx) <= 900 ? [dx >= 0 ? 1000 : -1000, my] : [mx, dy >= 0 ? 1000 : -1000];
      }
    }
  }
  if (danger && !attack) {
    const [vx, vy] = unit(danger.shot.vx, danger.shot.vy);
    [mx, my] = [-vy, vx]; // sideways to the shot
  }
  out.push({ ...base, seq, actionId: 'move', params: { moveX: Math.max(-1000, Math.min(1000, mx)) || 0,
    moveY: Math.max(-1000, Math.min(1000, my)) || 0 } });
  if (attack) out.push(attack);
  return out;
}
