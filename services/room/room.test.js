import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {createRoomServer} from './server.js';
import {hash, validate} from '../../packages/contracts/index.js';
import {Storage} from './storage.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class Client {
  constructor(url) {
    this.queue=[];this.waiters=[];this.meta={roomId:'',sessionId:'',epoch:1};this.seq=0;this.observers=[];
    this.ws=new WebSocket(url);
    this.ws.on('error',()=>{});
    this.ws.on('message',raw=>{
      const env=JSON.parse(raw);this.meta=env;this.queue.push(env);
      for(const observer of this.observers)observer(env);
      for(const waiter of [...this.waiters])waiter();
    });
  }
  send(type,payload) {
    const requestId=`q-${++this.seq}`;
    this.ws.send(JSON.stringify({protocolVersion:'0.1',type,roomId:this.meta.roomId,sessionId:this.meta.sessionId,
      epoch:this.meta.epoch,requestId,seq:this.seq,payload}));return requestId;
  }
  take(type,check=()=>true,timeoutMs=10000) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==tryTake);reject(Error(`Timed out: ${type}`));},timeoutMs);
      const tryTake=()=>{
        const index=this.queue.findIndex(e=>e.type===type&&check(e));
        if(index<0)return;
        clearTimeout(timer);this.waiters=this.waiters.filter(w=>w!==tryTake);resolve(this.queue.splice(index,1)[0]);
      };
      this.waiters.push(tryTake);tryTake();
    });
  }
  close(){this.ws.terminate();}
}
async function setup(t,options={}) {
  const root=await mkdtemp(join(tmpdir(),'balance-room-')),staticDir=join(root,'dist');
  await mkdir(staticDir);await writeFile(join(staticDir,'index.html'),'<h1>Local client</h1>');
  await writeFile(join(staticDir,'client.js'),'export const ready = true;');
  const server=createRoomServer({storageDir:join(root,'storage'),staticDir,...options});
  const clients=[];
  t.after(async()=>{for(const c of clients)c.close();await server.close();await rm(root,{recursive:true,force:true});});
  const address=await server.listen(0,'127.0.0.1'),base=`http://127.0.0.1:${address.port}`;
  const client=path=>{const c=new Client(base.replace('http:','ws:')+path);clients.push(c);return c;};
  return {server,base,client,root};
}
async function players(context,gameId='hero_arena') {
  const host=context.client(`/ws?role=display&gameId=${gameId}`),initial=await host.take('room.status');
  assert.match(initial.payload.joinCode,/^[A-Z0-9]{4}$/);
  host.send('room.join',{joinCode:initial.payload.joinCode,name:'Human One',hero:'bari'});
  const first=await host.take('room.status',e=>e.payload.you==='p1');
  const phone=context.client('/ws');await phone.take('room.status');
  phone.send('room.join',{joinCode:initial.payload.joinCode,name:'Human Two',hero:'real_armor'});
  const second=await phone.take('room.status',e=>e.payload.you==='p2');
  assert.equal(second.payload.seats[0].hero,'bari');assert.equal(second.payload.seats[1].hero,'real_armor');
  assert.equal(first.payload.you,'p1');
  return {host,phone,roomId:initial.roomId};
}
test('two WebSocket clients play 300 fixed ticks and persist the exact human MatchResult', {timeout:15000}, async t=>{
  const context=await setup(t),{host,phone,roomId}=await players(context);
  const noStart=phone.send('match.start',{});
  assert.equal((await phone.take('error',e=>e.requestId===noStart)).payload.code,'AUTH_EXPIRED');
  const noReset=phone.send('match.reset',{});
  assert.equal((await phone.take('error',e=>e.requestId===noReset)).payload.code,'AUTH_EXPIRED');
  let accepted=0;const pendingErrors=[];
  for(const [client,id,direction] of [[host,'p1',-1],[phone,'p2',1]]){
    let seq=0;
    client.observers.push(env=>{
      if(env.type==='input.ack')accepted++;
      if(env.type==='error')pendingErrors.push(env.payload.code);
      if(env.type!=='state.view'||env.payload.tick>=300)return;
      const view=env.payload.observation,me=view.payload.entities.find(e=>e.id===id);
      if(me.stunUntil>view.tick+1)return;
      client.send('input.submit',{playerId:id,seq:seq++,tick:view.tick+1,turnId:0,actionId:'move',
        params:{moveX:direction*1000,moveY:0}});
      if(view.tick%40===0&&me.recoveryUntil<=view.tick+1&&me.cooldowns[1]<=view.tick+1){
        client.send('input.submit',{playerId:id,seq:seq++,tick:view.tick+1,turnId:0,actionId:'projectile',
          params:{aimX:0,aimY:-1000}});
      }
    });
  }
  host.send('match.start',{seed:91,maxTicks:300});
  const started=await host.take('match.started');
  assert.deepEqual(started.payload.config.options.assignments,{p1:'bari',p2:'real_armor'});
  const ended=await host.take('match.ended',()=>true,12000),other=await phone.take('match.ended');
  validate('MatchResult',ended.payload.result);assert.deepEqual(ended.payload.result,other.payload.result);
  assert.equal(ended.payload.result.valid,true);assert.equal(ended.payload.result.statistics.durationTicks,300);
  assert.equal(ended.payload.result.outcome.reason,'max_ticks');assert.ok(accepted>=500,`acks: ${accepted}`);
  assert.ok(pendingErrors.every(code=>code==='LATE_INPUT'),JSON.stringify(pendingErrors));
  const records=JSON.parse(await readFile(context.server.storage.humanPath,'utf8'));
  assert.equal(records.length,1);assert.deepEqual(records[0],ended.payload.result);
  assert.equal(records[0].finalStateHash,hash(context.server.rooms.get(roomId).authority.state));
  assert.ok(records[0].statistics.players.every(p=>p.actions.every(a=>a.actionId!=='move')));
  assert.ok(context.server.rooms.get(roomId).authority.frames.some(f=>f.actions.length===4));
  host.send('match.reset',{});await host.take('room.status',e=>e.payload.phase==='lobby'&&e.epoch>started.epoch);
  assert.equal(context.server.rooms.get(roomId).authority,null);
});
test('seat, tick, seq, action-domain and forged system input rejection never mutates card state',async t=>{
  const context=await setup(t,{turnTimeoutMs:60000}),{host,phone,roomId}=await players(context,'hero_cards');
  host.send('match.start',{});await host.take('match.started');await phone.take('match.started');
  const room=context.server.rooms.get(roomId),before=hash(room.authority.state);
  const good={playerId:'p1',seq:1,tick:1,turnId:0,actionId:'end_turn',params:{}};
  for(const a of [{...good,playerId:'p2'},{...good,tick:0},{...good,tick:99},{...good,seq:-1},
    {...good,turnId:1},{...good,actionId:'system.timeout'},{...good,params:{script:'forged'}}]){
    const req=host.send('input.submit',a);await host.take('error',e=>e.requestId===req);
    assert.equal(hash(room.authority.state),before);assert.equal(room.authority.pending.size,0);
  }
  const req=host.send('input.submit',good),ack=await host.take('input.ack',e=>e.requestId===req);
  assert.equal(room.authority.state.tick,1);assert.equal(room.authority.state.turnId,1);
  const after=hash(room.authority.state),dupe=host.send('input.submit',good);
  const duplicate=await host.take('input.ack',e=>e.requestId===dupe);
  assert.deepEqual(duplicate.payload,ack.payload);assert.equal(hash(room.authority.state),after);
  await sleep(25);assert.equal(hash(room.authority.state),after);
  const invalidSeq=host.send('input.submit',{...good,seq:0,tick:2,turnId:1});
  await host.take('error',e=>e.requestId===invalidSeq);assert.equal(hash(room.authority.state),after);
  host.send('match.reset',{});const ended=await host.take('match.ended');
  assert.equal(ended.payload.result.valid,false);assert.equal(ended.payload.result.outcome.status,'running');
  assert.ok(ended.payload.result.statistics.players.every(p=>p.draws===0));
});
test('card timeout frames terminate six rounds and never expose private state',async t=>{
  const context=await setup(t,{turnTimeoutMs:15}),{host,phone,roomId}=await players(context,'hero_cards');
  host.send('match.start',{seed:7});const ended=await host.take('match.ended');
  assert.equal(ended.payload.result.valid,true);assert.equal(ended.payload.result.statistics.durationTicks,12);
  const authority=context.server.rooms.get(roomId).authority;
  assert.ok(authority.frames.every(f=>f.actions.length===0&&f.systemInputs[0].kind==='system.timeout'));
  const view=await phone.take('state.view');
  assert.equal('rng' in view.payload.observation,false);
  assert.ok(view.payload.observation.payload.entities.every(e=>!('deck' in e)&&!('hand' in e)));
  const available=await phone.take('actions.available');assert.ok(Array.isArray(available.payload.actions));
});
test('same-port static files, versioned data patches and threaded playtests for both games',async t=>{
  const context=await setup(t),{base,root}=context;
  assert.match(await (await fetch(base+'/')).text(),/Local client/);
  assert.match(await (await fetch(base+'/lobby')).text(),/Local client/);
  assert.match((await fetch(base+'/client.js')).headers.get('content-type'),/javascript/);
  assert.equal((await fetch(base+'/v1/missing')).status,404);
  await writeFile(join(root,'outside.txt'),'private');await symlink(join(root,'outside.txt'),join(root,'dist','escape.txt'));
  assert.equal((await fetch(base+'/escape.txt')).status,403);
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const original=await (await fetch(base+'/v1/data/hero_arena')).json();
  assert.equal(hash(original.data),original.dataHash);assert.equal('seats' in original.data.gameRules,false);
  const proposal={baseDataHash:original.dataHash,replacements:[{path:'/moves/1/power',value:72}],rationale:'numeric test'};
  const applied=await (await post('/v1/data/hero_arena/apply-patch',{proposal})).json();
  assert.notEqual(applied.dataHash,original.dataHash);
  const current=await (await fetch(base+'/v1/data/hero_arena')).json();assert.equal(current.data.moves[1].power,72);
  const retained=await (await fetch(base+`/v1/data/hero_arena?dataHash=${original.dataHash}`)).json();
  assert.deepEqual(retained,original);
  const bad=await post('/v1/data/hero_arena/apply-patch',{proposal:{...proposal,replacements:[{path:'/moves/1/script',value:1}]}});
  assert.equal(bad.status,400);assert.equal(context.server.storage.current.get('hero_arena'),applied.dataHash);
  assert.equal(new Storage(join(root,'storage')).get('hero_arena').dataHash,applied.dataHash);
  for(const gameId of ['hero_arena','hero_cards']) {
    const response=await post('/v1/playtest/run',{gameId,pairs:1});assert.equal(response.status,200);
    const run=await response.json();assert.ok(run.elapsedMs>0);assert.equal(run.recorded,true);
    const results=await (await fetch(base+run.resultsPath)).json();assert.equal(results.length,2);
    results.forEach(result=>{validate('MatchResult',result);assert.equal(result.valid,true);});
    assert.equal(results[0].config.dataHash,results[1].config.dataHash);
    assert.equal(results[0].config.dataHash,run.dataHash);
  }
  assert.equal((await post('/v1/playtest/run',{gameId:'hero_arena',pairs:0})).status,400);
});
test('join limits, malformed envelopes, disconnect, and stale epochs are enforced',async t=>{
  const context=await setup(t),{host,phone,roomId}=await players(context);
  const third=context.client('/ws');await third.take('room.status');
  const code=context.server.rooms.get(roomId).code;
  const req=third.send('room.join',{joinCode:code,name:'Extra',hero:'sepia'});
  assert.equal((await third.take('error',e=>e.requestId===req)).payload.code,'ROOM_FULL');
  third.ws.send('{');assert.equal((await third.take('error')).payload.code,'INVALID_SCHEMA');
  phone.close();await host.take('room.status',e=>e.payload.seats.length===1);
  third.send('room.join',{joinCode:code,name:'Replacement',hero:'sepia'});
  await third.take('room.status',e=>e.payload.you==='p2');
  host.send('match.start',{maxTicks:30});const start=await host.take('match.started');
  const room=context.server.rooms.get(roomId),baseEpoch=room.epoch;
  host.send('match.reset',{});await host.take('room.status',e=>e.epoch>baseEpoch);
  host.ws.send(JSON.stringify({protocolVersion:'0.1',type:'match.start',roomId,sessionId:host.meta.sessionId,
    epoch:start.epoch,seq:100,requestId:'stale',payload:{}}));
  assert.equal((await host.take('error',e=>e.requestId==='stale')).payload.code,'STALE_TURN');
});
