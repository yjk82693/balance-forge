import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runBatch,pairedJobs,runMatch} from './index.js';
import {validate} from '../../packages/contracts/index.js';
test('paired fixed seeds swap config hero assignments with one immutable content hash and retain seat IDs',()=>{
 const jobs=pairedJobs({seeds:[7,19]});assert.equal(jobs.length,4);
 for(let i=0;i<4;i+=2){assert.equal(jobs[i].config.seed,jobs[i+1].config.seed);assert.equal(jobs[i].config.options.assignments.p1,jobs[i+1].config.options.assignments.p2);assert.equal(jobs[i].config.options.assignments.p2,jobs[i+1].config.options.assignments.p1);assert.equal(jobs[i].config.dataHash,jobs[i+1].config.dataHash);assert.equal('seats' in jobs[i].data.gameRules,false);assert.deepEqual(jobs[i].config.players,jobs[i+1].config.players);}
});
test('worker counts preserve ordered results and fixture MatchResult shape',async()=>{
 const jobs=pairedJobs({seeds:[11,22]});
 const a=await runBatch(jobs,{workers:1}),b=await runBatch(jobs,{workers:2});
 assert.deepEqual(a.results,b.results);assert.ok(a.metrics.matchesPerSecond>0);assert.equal(a.metrics.invalidMatches,0);
 const fixture=JSON.parse(readFileSync(new URL('../../fixtures/match_results.json',import.meta.url)))[0];
 for(const result of a.results){validate('MatchResult',result);assert.deepEqual(Object.keys(result).sort(),Object.keys(fixture).sort());assert.ok(result.statistics.durationTicks<=1800);assert.notEqual(result.outcome.status,'running');}
});
test('runner marks a failed match invalid without recording a draw',async()=>{
 const [job]=pairedJobs({seeds:[1]});job.config.dataHash='f'.repeat(64);
 const result=runMatch(job);validate('MatchResult',result);assert.equal(result.valid,false);assert.equal(result.errorCode,'HASH_MISMATCH');assert.equal(result.outcome.status,'running');assert.ok(result.statistics.players.every(p=>p.draws===0));
 const batch=await runBatch([job],{workers:1});assert.equal(batch.metrics.invalidMatches,1);
});
