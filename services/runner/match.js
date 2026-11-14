import * as arena from '../../packages/games/action/index.js';
import {chooseAction,botPolicyVersion} from '../../packages/games/action/bot.js';
import {hash,validate,validateOutcome,compareIds} from '../../packages/contracts/index.js';
import {emptyStatistics} from '../../packages/sim/index.js';
export {botPolicyVersion};
export function runMatch(job) {
 const {matchId,config,data}=job;
 let state;
 try {
  state=arena.initial(config,data);
  while(arena.outcome(state).status==='running') {
   const actions=config.players.map((id,i)=>chooseAction(arena.observe(state,id),state.tick,i)).filter(Boolean).sort((a,b)=>compareIds(a.playerId,b.playerId));
   state=arena.step(state,{tick:state.tick+1,actions,systemInputs:[]},data).state;
  }
  const result={matchId,config,outcome:arena.outcome(state),statistics:arena.statistics(state),finalStateHash:arena.hash(state),valid:true,errorCode:''};
  validate('MatchResult',result);validateOutcome(result.outcome,config.players);return result;
 } catch(error) {
  // Failure is explicitly invalid and never contributes a draw or win.
  const known=['INVALID_SCHEMA','ILLEGAL_ACTION','LATE_INPUT','STALE_TURN','VERSION_MISMATCH','HASH_MISMATCH'];
  return {matchId,config,outcome:{status:'running',winners:[],reason:'invalid_match'},statistics:emptyStatistics(config.players,['melee','projectile','guard']),finalStateHash:hash(state??{}),valid:false,errorCode:known.includes(error.message)?error.message:'INVALID_SCHEMA'};
 }
}
export function pairedJobs({seeds=Array.from({length:100},(_,i)=>i+1),heroes=['bari','real_armor'],data=arena.data}={}) {
 if(heroes.length!==2||seeds.length===0||seeds.some(s=>!Number.isInteger(s)||s<1||s>4294967295))throw Error('INVALID_SCHEMA');
 const jobs=[];
 for(const seed of seeds)for(let swap=0;swap<2;swap++){
  const content=structuredClone(data);content.gameRules.seats=swap?[...heroes].reverse():[...heroes];
  jobs.push({matchId:`m-${jobs.length+1}`,config:arena.makeConfig(content,seed),data:content});
 }
 return jobs;
}
