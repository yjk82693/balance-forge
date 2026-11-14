// Evaluates many parameter vectors, optionally on worker threads. The result order always equals the task order, so how
// the work was scheduled can never change a result. Failure of one worker rejects the whole call and stops the rest.
import { Worker } from 'node:worker_threads';
import { evaluateVector } from './evaluate.ts';

/** One task: { hero, params, population, opponents, seeds, maxTicks } -> fitness. */
export async function evaluateMany(tasks, { workers = 1 } = {}) {
  if (!Array.isArray(tasks) || !Number.isInteger(workers) || workers < 1 || workers > 16) throw Error('INVALID_SCHEMA');
  if (workers === 1 || tasks.length < 2) return tasks.map(task => evaluateVector(task));
  const count = Math.min(workers, tasks.length);
  const chunks = Array.from({ length: count }, () => []);
  tasks.forEach((task, index) => chunks[index % count].push({ index, task }));
  const results = new Array(tasks.length);
  const pool = [];
  try {
    await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./eval-worker.ts', import.meta.url), { workerData: { chunk } });
      pool.push(worker);
      worker.on('message', message => {
        if (message.type === 'result') results[message.index] = message.fitness;
        else resolve();
      });
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(Error(`evaluation worker stopped with code ${code}`));
      });
    })));
  } finally {
    await Promise.allSettled(pool.map(worker => worker.terminate()));
  }
  if (results.some(value => !Number.isFinite(value))) throw Error('INVALID_SCHEMA');
  return results;
}
