import {test} from 'node:test';
import assert from 'node:assert/strict';
import {xorshift32} from './index.js';
import * as game from '../games/action/index.js';
import {chooseAction} from '../games/action/bot.js';
import {hash,validateGamePayload} from '../contracts/index.js';
test('xorshift32-v1 reference sequence and zero rejection',()=>{
 let x=1;const actual=[];for(let i=0;i<5;i++){x=xorshift32(x);actual.push(x);}assert.deepEqual(actual,[270369,67634689,2647435461,307599695,2398689233]);assert.throws(()=>xorshift32(0));
});
test('100 seeds × 1,000 active ticks × two runs: every tick hash matches',()=>{
 // Large legal health values keep combat active for the full 1,000-tick test.
 for(let seed=1;seed<=100;seed++){
  const data=structuredClone(game.data);for(const c of data.characters)c.health=1000000;
  const heroes=data.characters.map(c=>c.id);data.gameRules.seats=[heroes[seed%4],heroes[(seed+1)%4]];
  const config=game.makeConfig(data,seed),first=[],frames=[];
  let state=game.initial(config,data),rng=seed;
  for(let i=0;i<1000;i++){
   rng=xorshift32(rng);
   const actions=config.players.map((id,j)=>chooseAction(game.observe(state,id),i,(rng+j)%3)).filter(Boolean);
   const frame={tick:state.tick+1,actions,systemInputs:[]};frames.push(frame);
   state=game.step(state,frame,data).state;first.push(hash(state));
  }
  validateGamePayload('hero_arena',1,'state',state.payload);
  let second=game.initial(config,data),secondRng=seed;
  for(let i=0;i<1000;i++){
   secondRng=xorshift32(secondRng);
   const actions=config.players.map((id,j)=>chooseAction(game.observe(second,id),i,(secondRng+j)%3)).filter(Boolean);
   const secondFrame={tick:second.tick+1,actions,systemInputs:[]};
   assert.deepEqual(secondFrame,frames[i]);
   second=game.step(second,secondFrame,data).state;assert.equal(hash(second),first[i],`seed ${seed}, tick ${i+1}`);
  }
  assert.equal(second.tick,1000);
 }
});
