import { legalActions } from './index.js';
// No private state or ambient randomness: a scripted policy of public observations.
export const botPolicyVersion='scripted-0.1';
export function chooseAction(view, seq, variant=0) {
 const legal=legalActions(view),me=view.payload.entities.find(e=>e.id===view.viewerId),enemy=view.payload.entities.find(e=>e.id!==view.viewerId);
 if(!legal.length||!enemy)return null;
 const dx=enemy.x-me.x,dy=enemy.y-me.y,close=dx*dx+dy*dy<=1800**2;
 const preference=close?['melee','guard','projectile']:(variant%3===1&&view.tick%120<55?['guard','projectile','melee']:['projectile','guard','melee']);
 const actionId=preference.find(id=>legal.some(a=>a.actionId===id));
 const params={moveX:close?0:Math.sign(dx)*1000,moveY:Math.sign(dy)*1000};
 if(actionId==='projectile'){const norm=Math.max(Math.abs(dx),Math.abs(dy),1);params.aimX=Math.trunc(dx*1000/norm)||0;params.aimY=Math.trunc(dy*1000/norm)||0;if(!params.aimX&&!params.aimY)params.aimX=1000;}
 return {playerId:view.viewerId,seq,tick:view.tick+1,turnId:0,actionId,params};
}
