import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {availableParallelism} from 'node:os';
import {validate} from '../../packages/contracts/index.js';
import {botPolicyVersion,pairedJobs} from './match.js';
export {pairedJobs,runMatch} from './match.js';
export async function runBatch(jobs,{workers=Math.min(4,availableParallelism()),captureReplays=false}={}) {
 if(!Number.isInteger(workers)||workers<1||workers>64||!Array.isArray(jobs)||!jobs.length)throw Error('INVALID_SCHEMA');
 const count=Math.min(workers,jobs.length),chunks=Array.from({length:count},()=>[]),pool=[];
 jobs.forEach((job,index)=>chunks[index%count].push({index,job}));
 const start=performance.now();
 try {
  const batches=await Promise.all(chunks.map(chunk=>new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{jobs:chunk,captureReplays}});pool.push(worker);let received=false;
   worker.once('message',message=>{received=true;resolve(message);});worker.once('error',reject);
   worker.once('exit',code=>{if(code!==0||!received)reject(Error(`Worker exited ${code} before completing its batch`));});
  })));
  const results=batches.flat().sort((a,b)=>a.index-b.index).map(x=>x.result);
  for(const result of results)validate('MatchResult',result);
  const elapsedMs=performance.now()-start;
  return {results,...(captureReplays?{replays:batches.flat().sort((a,b)=>a.index-b.index).map(x=>x.replay)}:{}),metrics:{kind:'recorded',matchCount:results.length,validMatches:results.filter(r=>r.valid).length,invalidMatches:results.filter(r=>!r.valid).length,workers:count,elapsedMs,matchesPerSecond:results.length*1000/elapsedMs,includesWorkerStartup:true,botPolicyVersion,seedSetId:'explicit-paired-seeds',seeds:[...new Set(jobs.map(j=>j.config.seed))]}};
 } finally {await Promise.all(pool.map(worker=>worker.terminate()));}
}
