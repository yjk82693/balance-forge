import {parentPort,workerData} from 'node:worker_threads';
import {executeMatch} from './match.js';
parentPort.postMessage(workerData.jobs.map(({index,job})=>({index,...executeMatch(job,{captureReplay:workerData.captureReplays})})));
