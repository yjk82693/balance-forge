import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson, hash, validate } from './index.js';
const fixture=n=>JSON.parse(readFileSync(new URL('../../fixtures/'+n+'.json',import.meta.url)));
test('all shared fixtures validate',()=>{ for(const [f,t] of [['match_config','MatchConfig'],['observation','Observation'],['patch_proposal','PatchProposal'],['report_baseline','Report'],['report_patched','Report']]) validate(t,fixture(f)); fixture('match_results').forEach(x=>validate('MatchResult',x)); });
test('canonical keys, Unicode code points, integer rejection, SHA-256',()=>{ assert.equal(canonicalJson({b:1,a:[2,3]}),'{"a":[2,3],"b":1}'); assert.equal(canonicalJson({'𐀀':1,'\ue000':2}),'{"":2,"𐀀":1}'); assert.equal(hash({b:1,a:2}),hash({a:2,b:1})); assert.match(hash({}),/^[a-f0-9]{64}$/); for(const v of [undefined,NaN,Infinity,-0,0.5, {x:undefined},new Date()]) assert.throws(()=>canonicalJson(v)); });
test('schema is identical to normative bundle and transport fixture payloads validate', () => {
 const spec=readFileSync(new URL('../../spec/contract-v0.1.md',import.meta.url),'utf8');
 assert.deepEqual(JSON.parse(spec.match(/```json\n([\s\S]*?)```/)[1]),JSON.parse(readFileSync(new URL('./schema.json',import.meta.url))));
 for(const message of fixture('ws_messages')) {
  if(message.type==='input.submit') validate('ActionInput',message.payload);
  if(message.type==='state.view') validate('Observation',message.payload.observation);
  if(message.type==='match.ended') validate('MatchResult',message.payload.result);
 }
});
test('malformed closed shapes and recursive values are rejected',()=>{
 const config=fixture('match_config');
 assert.throws(()=>validate('MatchConfig',{...config,extra:1}));
 assert.throws(()=>validate('MatchConfig',{...config,players:['p1','p1']}));
 const cycle={}; cycle.self=cycle; assert.throws(()=>canonicalJson(cycle));
});
