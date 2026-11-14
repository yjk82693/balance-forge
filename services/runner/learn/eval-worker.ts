import { parentPort, workerData } from 'node:worker_threads';
import { evaluateVector } from './evaluate.ts';

for (const { index, task } of workerData.chunk) {
  parentPort.postMessage({ type: 'result', index, fitness: evaluateVector(task) });
}
parentPort.postMessage({ type: 'done' });
