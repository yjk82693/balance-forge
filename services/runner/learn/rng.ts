// Seeded random numbers for the trainer. Integer xorshift32 (the simulation project's own generator); the "normal"
// draw sums twelve uniforms (Irwin-Hall), so it needs nothing but addition and multiplication and is identical on every
// machine. The trainer never touches the simulation RNG.
import { xorshift32 } from '../../../packages/sim/index.ts';

export function makeRng(seed) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw Error('INVALID_SCHEMA');
  let state = seed >>> 0;
  const next = () => {
    state = xorshift32(state);
    return state;
  };
  const uniform = () => next() / 4294967296; // [0, 1)
  const normal = () => {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += uniform();
    return sum - 6; // mean 0, variance 1, within +-6
  };
  return { next, uniform, normal, int: maximum => next() % maximum };
}

/** A child seed for a named stream, so the sampler, the shuffles and the coach never share a sequence. */
export const subSeed = (seed, stream) => (xorshift32(((seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0) || 1) || 1);
