import { hash, validate, registerGame, validateGamePayload, validateConfig, validateFrame, compareIds } from '../../contracts/index.js';
import { clamp, xorshift32, pinData, assertPinned, emptyStatistics, statisticsDelta } from '../../sim/index.js';
import { actions, schemas } from './schemas.js';
export { data } from './data.js';
export { hash };
export const simVersion='arena-0.1.0';
registerGame('hero_arena',1,schemas);
const ids=actions.map(a=>a.actionId);
export const describe=()=>({gameId:'hero_arena',titleKey:'game.hero_arena',mode:'realtime',minPlayers:2,maxPlayers:2,actions:structuredClone(actions)});
export function makeConfig(data,seed=1,players=['p1','p2'],maxTicks=1800) {
 return {contractVersion:'0.1',schemaVersion:1,gameId:'hero_arena',simVersion,dataHash:pinData(data),seed,players,mode:'realtime',maxTicks};
}
export function initial(config,data) {
 validateConfig(config,data,describe(),simVersion);
 if(config.maxTicks>1800) throw Error('INVALID_SCHEMA');
 for(const [i,id] of data.gameRules.seats.entries()) {
  if(!data.characters.some(c=>c.id===id)) throw Error('INVALID_SCHEMA');
  const c=data.characters.find(c=>c.id===id);
  if(ids.some(a=>!c.moveIds.map(id=>data.moves.find(m=>m.id===id)?.archetype).includes(a))) throw Error('INVALID_SCHEMA');
  if(i>1) throw Error('INVALID_SCHEMA');
 }
 for(const t of data.gameRules.moveTraits) if(!data.moves.some(m=>m.id===t.moveId)) throw Error('INVALID_SCHEMA');
 pinData(data);
 const entities=config.players.map((id,i)=>({id,hero:data.gameRules.seats[i],x:i===0?4200:11800,y:4500,hp:data.characters.find(c=>c.id===data.gameRules.seats[i]).health,facing:i===0?0:180,cooldowns:[0,0,0],guardUntil:0,shield:0,stunUntil:0,recoveryUntil:0,lastSeq:-1,pending:{actionId:'',due:0,aimX:0,aimY:0}})).sort((a,b)=>compareIds(a.id,b.id));
 const rng=xorshift32(config.seed);
 for(const e of entities)e.y+=rng%201-100;
 const state={tick:0,rng,turnId:0,payload:{config:structuredClone(config),entities,projectiles:[],nextProjectile:0,hitStop:0,outcome:{status:'running',winners:[],reason:'in_progress'},statistics:emptyStatistics(config.players,ids)}};
 validateGamePayload('hero_arena',1,'state',state.payload); return state;
}
const ready=(e,tick,hitStop)=>e.hp>0&&!hitStop&&!e.pending.actionId&&e.stunUntil<=tick&&e.recoveryUntil<=tick;
function available(e,tick,hitStop){return ready(e,tick,hitStop)?actions.filter((_,i)=>e.cooldowns[i]<=tick):[];}
export function observe(state,viewerId) {
 const view={tick:state.tick,viewerId,payload:{arena:{w:16000,h:9000},entities:structuredClone(state.payload.entities),projectiles:structuredClone(state.payload.projectiles),outcome:structuredClone(state.payload.outcome),hitStop:state.payload.hitStop}};
 validate('Observation',view); validateGamePayload('hero_arena',1,'observation',view.payload); return view;
}
export function legalActions(view) {
 validateGamePayload('hero_arena',1,'observation',view.payload);
 if(view.payload.outcome.status!=='running') return [];
 const e=view.payload.entities.find(e=>e.id===view.viewerId);
 return e?structuredClone(available(e,view.tick+1,view.payload.hitStop)):[];
}
export const outcome=state=>structuredClone(state.payload.outcome);
export const statistics=state=>structuredClone(state.payload.statistics);
const distance=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const quotient=(a,b)=>Math.trunc(a/b)||0;
function moveFor(data,e,actionId){const c=data.characters.find(c=>c.id===e.hero);return data.moves.find(m=>c.moveIds.includes(m.id)&&m.archetype===actionId);}
export function step(state,frame,data) {
 assertPinned(state,data);
 if(state.payload.outcome.status!=='running') throw Error('ILLEGAL_ACTION');
 const players=state.payload.config.players;
 validateFrame(state,frame,players,actions,a=>{
  const e=state.payload.entities.find(e=>e.id===a.playerId);
  return a.seq>e.lastSeq && available(e,frame.tick,state.payload.hitStop).some(s=>s.actionId===a.actionId) && (a.actionId!=='projectile'||a.params.aimX!==0||a.params.aimY!==0);
 });
 if(frame.systemInputs.length) throw Error('ILLEGAL_ACTION');
 const next=structuredClone(state),p=next.payload,tick=frame.tick,events=[];
 next.tick=tick;
 const event=(kind,payload)=>events.push({eventId:`${tick}:${events.length}`,audience:[],kind,payload});
 const statsFor=id=>p.statistics.players.find(s=>s.playerId===id);
 for(const e of p.entities) for(const spec of available(e,tick,p.hitStop)) statsFor(e.id).actions[ids.indexOf(spec.actionId)].opportunities++;
 if(p.hitStop>0) {
  p.hitStop--;
  for(const e of p.entities) {
   for(const key of ['guardUntil','stunUntil','recoveryUntil']) if(e[key]>=tick) e[key]++;
   e.cooldowns=e.cooldowns.map(n=>n>=tick?n+1:n);
   if(e.pending.actionId)e.pending.due++;
  }
 } else {
  for(const a of frame.actions) {
   const e=p.entities.find(e=>e.id===a.playerId),c=data.characters.find(c=>c.id===e.hero),m=moveFor(data,e,a.actionId),tier=data.weightTiers[m.weightTier];
   e.lastSeq=a.seq;
   e.x=clamp(e.x+quotient((a.params.moveX??0)*c.speed,1000),0,16000);
   e.y=clamp(e.y+quotient((a.params.moveY??0)*c.speed,1000),0,9000);
   if(a.params.aimX) e.facing=a.params.aimX<0?180:0;
   e.pending={actionId:a.actionId,due:tick+tier.startupTicks,aimX:a.params.aimX??0,aimY:a.params.aimY??0};
   e.cooldowns[ids.indexOf(a.actionId)]=tick+tier.cooldownTicks;
   e.recoveryUntil=tick+tier.startupTicks+tier.recoveryTicks;
   statsFor(e.id).actions[ids.indexOf(a.actionId)].uses++;
   event('action.used',{playerId:e.id,actionId:a.actionId});
  }
  const hits=[];
  for(const e of p.entities) {
   if(!e.pending.actionId||e.pending.due>tick||e.hp<=0)continue;
   const pending=e.pending,m=moveFor(data,e,pending.actionId);
   e.pending={actionId:'',due:0,aimX:0,aimY:0};
   if(m.archetype==='guard') {
    const shield=m.effects.find(f=>f.operator==='shield');
    e.guardUntil=tick+(shield?.durationTicks??data.gameRules.guardDuration);e.shield=shield?.amount??100;
   } else if(m.archetype==='melee') {
    for(const target of p.entities) if(target.id!==e.id&&target.hp>0&&distance(e,target)<=data.gameRules.meleeRange**2)hits.push({owner:e.id,target:target.id,moveId:m.id,power:m.power,ignoresGuard:false});
   } else {
    const norm=Math.max(Math.abs(pending.aimX),Math.abs(pending.aimY),1);
    p.projectiles.push({id:`pr${p.nextProjectile++}`,owner:e.id,kind:m.id,x:e.x,y:e.y,vx:quotient(pending.aimX*data.gameRules.projectileSpeed,norm),vy:quotient(pending.aimY*data.gameRules.projectileSpeed,norm),life:data.gameRules.projectileLife,power:m.power,moveId:m.id,ignoresGuard:data.gameRules.moveTraits.find(t=>t.moveId===m.id)?.ignoresGuard??false});
   }
  }
  const surviving=[];
  for(const shot of p.projectiles.sort((a,b)=>compareIds(a.id,b.id))) {
   shot.x+=shot.vx;shot.y+=shot.vy;shot.life--;
   const target=p.entities.find(e=>e.id!==shot.owner&&e.hp>0&&distance(shot,e)<=data.gameRules.projectileRadius**2);
   if(target) hits.push({...shot,target:target.id});
   else if(shot.life>0&&shot.x>=0&&shot.x<=16000&&shot.y>=0&&shot.y<=9000)surviving.push(shot);
  }
  p.projectiles=surviving;
  // Resolve queued hits in stable source order; simultaneous attacks can produce a draw.
  for(const hit of hits) {
   const source=p.entities.find(e=>e.id===hit.owner),target=p.entities.find(e=>e.id===hit.target),m=data.moves.find(m=>m.id===hit.moveId),tier=data.weightTiers[m.weightTier];
   const guarded=target.guardUntil>tick&&!hit.ignoresGuard;
   let amount=quotient((hit.power+m.effects.filter(e=>e.operator==='damage').reduce((n,e)=>n+e.amount,0))*data.tuning.damageScalePermille,1000);
   if(guarded) amount=quotient(amount*(100-clamp(target.shield,0,100)),100);
   amount=clamp(amount,0,target.hp);target.hp-=amount;statsFor(source.id).damage+=amount;
   if(amount>0) {
    target.stunUntil=Math.max(target.stunUntil,tick+tier.stunTicks);
    target.pending={actionId:'',due:0,aimX:0,aimY:0};
    const knockback=tier.knockback+m.effects.filter(e=>e.operator==='knockback').reduce((n,e)=>n+e.amount,0);
    target.x=clamp(target.x+(target.x>=source.x?1:-1)*knockback,0,16000);
    p.hitStop=Math.max(p.hitStop,tier.hitStopTicks);
    for(const effect of m.effects) {
     if(effect.operator==='cooldown')target.cooldowns=target.cooldowns.map(n=>clamp(n+effect.amount,0,2147483647));
     if(effect.operator==='shield'){source.shield=clamp(effect.amount,0,1000000);source.guardUntil=tick+effect.durationTicks;}
    }
   }
   event('combat.hit',{source:source.id,target:target.id,amount,guarded,ignoresGuard:hit.ignoresGuard});
  }
 }
 const alive=p.entities.filter(e=>e.hp>0);
 if(alive.length<2) p.outcome=alive.length===1?{status:'win',winners:[alive[0].id],reason:'hp_zero'}:{status:'draw',winners:[],reason:'mutual_elimination'};
 else if(tick>=p.config.maxTicks)p.outcome={status:'draw',winners:[],reason:'max_ticks'};
 p.statistics.durationTicks=tick;
 if(p.outcome.status!=='running')for(const s of p.statistics.players){s.wins=p.outcome.winners.includes(s.playerId)?1:0;s.draws=p.outcome.status==='draw'?1:0;}
 return {state:next,events,outcome:outcome(next),statisticsDelta:statisticsDelta(state.payload.statistics,p.statistics)};
}
export const adapter={describe,initial,observe,legalActions,step,outcome,statistics,hash};
