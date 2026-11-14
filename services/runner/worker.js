import {parentPort,workerData} from 'node:worker_threads';
import {runMatch} from './match.js';
parentPort.postMessage(workerData.map(({index,job})=>({index,result:runMatch(job)})));
