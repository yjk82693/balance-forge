import * as arena from '../../packages/games/action/index.js';
import * as cards from '../../packages/games/cards/index.js';
import {chooseActions,botPolicyVersion} from '../../packages/games/action/bot.js';
import {hash,validate,validateOutcome,compareIds} from '../../packages/contracts/index.js';
import {emptyStatistics} from '../../packages/sim/index.js';
export {botPolicyVersion};
export const games={hero_arena:arena,hero_cards:cards};
function cardAction(game,state,seq){
 const view=game.observe(state,state.payload.activePlayer),e=view.payload.entities.find(e=>e.id===view.viewerId);
 const index=view.payload.hand.findIndex(c=>c.cost<=e.energy&&(c.kind!=='summon'||e.units.length<2));
 return {playerId:view.viewerId,seq,tick:state.tick+1,turnId:state.turnId,actionId:index<0?'end_turn':'play',params:index<0?{}:{handIndex:index,...(view.payload.hand[index].kind==='summon'?{slot:e.units.length}:{})}};
}
export function runMatch(job) {
 const {matchId,config,data}=job,game=games[config.gameId];let state;
 try {
  if(!game)throw Error('INVALID_SCHEMA');
  state=game.initial(config,data);
  while(game.outcome(state).status==='running') {
   const actions=config.mode==='turn'?[cardAction(game,state,state.tick)]:config.players.flatMap((id,i)=>chooseActions(game.observe(state,id),state.tick*2,i)).sort((a,b)=>compareIds(a.playerId,b.playerId));
   state=game.step(state,{tick:state.tick+1,actions,systemInputs:[]},data).state;
  }
  const result={matchId,config,outcome:game.outcome(state),statistics:game.statistics(state),finalStateHash:game.hash(state),valid:true,errorCode:''};
  validate('MatchResult',result);validateOutcome(result.outcome,config.players);return result;
 } catch(error) {
  const known=['INVALID_SCHEMA','ILLEGAL_ACTION','LATE_INPUT','STALE_TURN','VERSION_MISMATCH','HASH_MISMATCH'];
  return {matchId,config,outcome:{status:'running',winners:[],reason:'invalid_match'},statistics:emptyStatistics(config.players,game?.describe().actions.map(a=>a.actionId)??[]),finalStateHash:hash(state??{}),valid:false,errorCode:known.includes(error.message)?error.message:'INVALID_SCHEMA'};
 }
}
export function pairedJobs({seeds=Array.from({length:100},(_,i)=>i+1),heroes=['bari','real_armor'],gameId='hero_arena',data=games[gameId]?.data}={}) {
 const game=games[gameId];
 if(!game||heroes.length!==2||seeds.length===0||seeds.some(s=>!Number.isInteger(s)||s<1||s>4294967295))throw Error('INVALID_SCHEMA');
 const jobs=[];
 for(const seed of seeds)for(let swap=0;swap<2;swap++){
  const players=['p1','p2'],order=swap?[...heroes].reverse():heroes;
  const config=game.makeConfig(data,seed,players);
  config.options={assignments:Object.fromEntries(players.map((id,i)=>[id,gameId==='hero_arena'?order[i]:'standard']))};
  jobs.push({matchId:`m-${jobs.length+1}`,config,data});
 }
 return jobs;
}
