import {parentPort,workerData} from 'node:worker_threads';
import {executeMatch} from './match.js';
for(const {index,job} of workerData.jobs) {
  parentPort.postMessage({type:'result',row:{index,...executeMatch(job,{captureReplay:workerData.captureReplays})}});
}
parentPort.postMessage({type:'done'});
