// Cross-entropy method over a bounded integer parameter vector. Each generation a proposer suggests candidate vectors,
// the caller scores them, and the proposer learns from the scores. The default proposer samples a Gaussian in the
// normalised [0, 1] space of every parameter (seeded), keeps the top share, and refits the mean and the spread.
// The same Proposer interface is what the model-guided coach implements, so both search under the same budget.
//
//   proposer.propose({ generation, count }) -> [params] or a promise of it   (validated by the caller)
//   proposer.update({ generation, scored: [{ params, fitness }] })           (may be async)
//   proposer.origin: 'cem' | 'gemini' | 'fake' ...                (labels where the candidates came from)
import { PARAM_NAMES, PARAM_SPECS, sanitizeParams } from '../../../packages/games/action/bot-learned.ts';
import { makeRng, subSeed } from './rng.ts';

const span = name => PARAM_SPECS[name].max - PARAM_SPECS[name].min;
export const toUnit = (name, value) => (value - PARAM_SPECS[name].min) / span(name);
export const fromUnit = (name, unit) => PARAM_SPECS[name].min + Math.round(Math.min(1, Math.max(0, unit)) * span(name));

export const MIN_SPREAD = 0.02; // the search never collapses to a point

/** Gaussian CEM proposer. `start`: the initial mean (a parameter vector); `spread`: initial deviation (unit space). */
export function cemProposer({ seed, start, spread = 0.25, eliteShare = 0.25, smoothing = 0.7 }) {
  const rng = makeRng(subSeed(seed, 1));
  let mean = Object.fromEntries(PARAM_NAMES.map(name => [name, toUnit(name, start[name])]));
  let deviation = Object.fromEntries(PARAM_NAMES.map(name => [name, spread]));
  return {
    origin: 'cem',
    state: () => ({ mean: { ...mean }, deviation: { ...deviation } }),
    propose({ generation, count }) {
      const out = [];
      for (let i = 0; i < count; i++) {
        // The first candidate of generation 0 is the starting point itself: the search never does worse than it.
        out.push(generation === 0 && i === 0 ? { ...start } : Object.fromEntries(PARAM_NAMES.map(name =>
          [name, fromUnit(name, mean[name] + deviation[name] * rng.normal())])));
      }
      return out;
    },
    update({ scored }) {
      const keep = Math.max(2, Math.ceil(scored.length * eliteShare));
      const elite = [...scored].sort((a, b) => b.fitness - a.fitness).slice(0, keep);
      for (const name of PARAM_NAMES) {
        const values = elite.map(e => toUnit(name, e.params[name]));
        const m = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
        mean[name] = smoothing * m + (1 - smoothing) * mean[name];
        deviation[name] = Math.max(MIN_SPREAD, smoothing * Math.sqrt(variance) + (1 - smoothing) * deviation[name]);
      }
    }
  };
}

/**
 * Runs the search. `evaluate(paramsList, generation)` returns the fitness of each vector (a promise of an array, same
 * order). Every proposed vector is sanitised against the parent (the best so far), so a bad proposal cannot crash
 * a run.
 * Returns { best, bestFitness, evaluated, curve: [{ generation, best, mean, eliteMean, fellBack }] }.
 */
export async function runSearch({ proposer, evaluate, generations, population, start, eliteShare = 0.25 }) {
  let parent = { ...start };
  let best = { params: parent, fitness: -Infinity };
  const curve = [];
  let evaluated = 0;
  for (let generation = 0; generation < generations; generation++) {
    const proposed = await proposer.propose({ generation, count: population });
    let fellBack = 0;
    const candidates = proposed.slice(0, population).map(raw => {
      const { params, fellBack: bad } = sanitizeParams(raw, parent);
      fellBack += bad.length ? 1 : 0;
      return params;
    });
    const fitness = await evaluate(candidates, generation);
    if (!Array.isArray(fitness) || fitness.length !== candidates.length || fitness.some(f => !Number.isFinite(f))) {
      throw Error('INVALID_SCHEMA');
    }
    evaluated += candidates.length;
    const scored = candidates.map((params, i) => ({ params, fitness: fitness[i] }));
    for (const entry of scored) if (entry.fitness > best.fitness) best = entry;
    parent = best.params;
    await proposer.update({ generation, scored });
    const sorted = [...scored].sort((a, b) => b.fitness - a.fitness);
    const keep = Math.max(2, Math.ceil(scored.length * eliteShare));
    const mean = list => list.reduce((s, e) => s + e.fitness, 0) / list.length;
    curve.push({ generation, best: sorted[0].fitness, mean: mean(scored), eliteMean: mean(sorted.slice(0, keep)),
      fellBack });
  }
  return { best: best.params, bestFitness: best.fitness, curve, evaluated };
}
