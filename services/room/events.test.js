import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localServer} from './test-helpers.js';
test('state.view carries actual step events once and keeps private card peeks seat safe',async t=>{
 const {server,host,phone,room}=await localServer(t);
 host.request('match.start',{gameId:'hero_cards'});
 const authority=room.authority;authority.state.payload.entities[0].hand=['forethought'];
 host.request('input.submit',{playerId:'p1',seq:0,tick:1,turnId:0,actionId:'play',params:{handIndex:0}});
 assert.ok(host.take('state.view').payload.events.some(e=>e.kind==='card.peek'));
 assert.ok(phone.take('state.view').payload.events.every(e=>e.kind!=='card.peek'));
 server.view(room.host);
 assert.deepEqual(host.take('state.view').payload.events,[]);
 host.request('match.reset',{});host.request('match.start',{gameId:'hero_arena',maxTicks:50});
 host.request('input.submit',{playerId:'p1',seq:0,tick:1,turnId:0,actionId:'projectile',params:{aimX:0,aimY:-1000}});
 for(let i=0;i<8;i++)server.advance(room);
 assert.ok(host.messages.filter(e=>e.type==='state.view').some(e=>e.payload.events.some(x=>x.kind==='projectile.spawn')));
});
