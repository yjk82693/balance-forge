import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as game from './index.js';
import {chooseAction} from './bot.js';
import {hash,validate,validateGamePayload,restoreSnapshot,applyPatch,validateData,validateFrame,validateOutcome} from '../../contracts/index.js';
import {Authority,replay,statisticsDelta} from '../../sim/index.js';
const make=(data=game.data,seed=1,maxTicks=1800)=>game.initial(game.makeConfig(data,seed,['p1','p2'],maxTicks),data);
const frame=(state,actions=[])=>({tick:state.tick+1,actions,systemInputs:[]});
const input=(state,playerId,actionId,params={})=>({playerId,seq:state.tick,tick:state.tick+1,turnId:0,actionId,params});
function advance(state,data,count){for(let i=0;i<count;i++)state=game.step(state,frame(state),data).state;return state;}
test('descriptor, config, state, observation and step implement shared contract',()=>{
 validate('GameDescriptor',game.describe());validateData(game.data);
 validateGamePayload('hero_arena',1,'action:projectile',{aimX:1000,aimY:0});
 assert.throws(()=>validateGamePayload('hero_arena',1,'action:guard',{script:'x'}));
 let state=make();const before=hash(state);
 const next=game.step(state,frame(state),game.data);validate('StepResult',next);
 assert.equal(hash(state),before);assert.equal(next.state.tick,1);
 validateGamePayload('hero_arena',1,'state',next.state.payload);
 const view=game.observe(state,'p1');validate('Observation',view);
 assert.equal('rng' in view,false);assert.equal('config' in view.payload,false);
 assert.equal(game.legalActions(view).length,3);
 const fixture=JSON.parse(readFileSync(new URL('../../../fixtures/ws_messages.json',import.meta.url)));
 const action=fixture.find(m=>m.type==='input.submit').payload;
 state=advance(state,game.data,240);
 validate('StepResult',game.step(state,frame(state,[action]),game.data));
});
test('all heroes, cap and neutral missing input',()=>{
 for(const hero of ['bari','real_armor','daewi','sepia']){
  const data=structuredClone(game.data);data.gameRules.seats=[hero,'bari'];
  let state=make(data,1,3);const x=state.payload.entities[0].x;
  state=advance(state,data,3);assert.equal(state.payload.entities[0].x,x);assert.equal(state.tick,3);assert.equal(game.outcome(state).status,'draw');
  assert.throws(()=>game.step(state,frame(state),data),/ILLEGAL_ACTION/);
 }
 assert.throws(()=>make(game.data,1,1801));
});
test('projectile guard bypass is data driven; ordinary projectile is blocked',()=>{
 const combat=(hero)=>{
  const data=structuredClone(game.data);data.gameRules.seats=[hero,'real_armor'];
  let state=make(data);state.payload.entities[0].x=7000;state.payload.entities[1].x=8200;
  state=game.step(state,frame(state,[input(state,'p1','projectile',{aimX:1000,aimY:0}),input(state,'p2','guard')]),data).state;
  state=advance(state,data,10);return state;
 };
 const bypass=combat('bari'),ordinary=combat('sepia');
 assert.ok(bypass.payload.entities[1].hp<700);assert.equal(ordinary.payload.entities[1].hp,700);
 const changed=structuredClone(game.data);changed.gameRules.moveTraits[0].ignoresGuard=false;
 let state=make(changed);state.payload.entities[0].x=7000;state.payload.entities[1].x=8200;
 state=game.step(state,frame(state,[input(state,'p1','projectile',{aimX:1000,aimY:0}),input(state,'p2','guard')]),changed).state;
 assert.equal(advance(state,changed,10).payload.entities[1].hp,700);
});
test('startup, cooldown, melee hit, terminal result and additive statistics',()=>{
 let state=make();state.payload.entities[0].x=7000;state.payload.entities[1].x=8000;state.payload.entities[1].hp=1;
 const initial=structuredClone(state.payload.statistics),totals=structuredClone(initial);
 const run=actions=>{const r=game.step(state,frame(state,actions),game.data);validate('StepResult',r);state=r.state;const d=r.statisticsDelta;totals.durationTicks+=d.durationTicks;for(let i=0;i<2;i++){for(const k of ['wins','draws','damage'])totals.players[i][k]+=d.players[i][k];for(let j=0;j<3;j++)for(const k of ['uses','opportunities'])totals.players[i].actions[j][k]+=d.players[i].actions[j][k];}};
 run([input(state,'p1','melee')]);assert.equal(state.payload.entities[1].hp,1);
 assert.throws(()=>game.step(state,frame(state,[input(state,'p1','melee')]),game.data),/ILLEGAL_ACTION/);
 run([]);run([]);run([]);assert.equal(game.outcome(state).status,'win');assert.equal(state.tick,4);
 assert.deepEqual(totals,game.statistics(state));assert.equal(totals.players[0].damage,1);
});
test('invalid inputs never mutate state; data and snapshots remain pinned',()=>{
 const state=make(),before=hash(state),good=input(state,'p1','projectile',{aimX:1000,aimY:0});
 for(const action of [{...good,tick:0},{...good,turnId:1},{...good,seq:-1},{...good,playerId:'intruder'},{...good,params:{aimX:1001,aimY:0}},{...good,params:{aimX:0,aimY:0}},{...good,params:{aimX:1,aimY:0,script:'x'}}])assert.throws(()=>game.step(state,frame(state,[action]),game.data));
 assert.throws(()=>game.step(state,frame(state,[good,good]),game.data));assert.equal(hash(state),before);
 const altered=structuredClone(game.data);altered.moves[1].power++;
 assert.throws(()=>game.step(state,frame(state),altered),/HASH_MISMATCH/);
 const config=state.payload.config,snapshot={config,tick:0,state,stateHash:hash(state)};
 assert.deepEqual(restoreSnapshot(snapshot,config),state);
 assert.throws(()=>restoreSnapshot({...snapshot,tick:1},config),/HASH_MISMATCH/);
 assert.throws(()=>restoreSnapshot(snapshot,{...config,simVersion:'other'}),/VERSION_MISMATCH/);
 assert.throws(()=>validateOutcome({status:'win',winners:['x'],reason:'hp_zero'},config.players));
 const patched=applyPatch(game.data,{baseDataHash:hash(game.data),replacements:[{path:'/moves/1/power',value:72}],rationale:'test'});
 assert.equal(patched.moves[1].power,72);assert.notEqual(hash(patched),hash(game.data));
 assert.throws(()=>applyPatch(game.data,{baseDataHash:hash(game.data),replacements:[{path:'/tuning/damageScalePermille',value:0}],rationale:'test'}));
});
test('authority deduplicates receipts and replays the accepted frame stream',()=>{
 const config=game.makeConfig(game.data,42),server=new Authority(game.adapter,config,game.data);
 const a=input(server.state,'p1','projectile',{aimX:1000,aimY:0});
 assert.deepEqual(server.submit(a),server.submit(a));server.advance();assert.deepEqual(server.submit(a),{seq:0,status:'accepted',acceptedTick:1});
 for(let i=0;i<20;i++)server.advance();
 assert.equal(hash(replay(game.adapter,config,game.data,server.frames)),hash(server.state));
 assert.throws(()=>server.submit({...a,seq:1}),/LATE_INPUT/);
});
