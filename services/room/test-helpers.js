import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRoomServer} from './server.js';
// Exercises the production WebSocket handlers without opening a network listener.
export class LocalSocket extends EventEmitter {
  readyState=1;bufferedAmount=0;messages=[];
  send(raw){this.messages.push(JSON.parse(raw));}
  close(){this.readyState=3;this.emit('close');}
  terminate(){this.close();}
  take(type){return this.messages.filter(e=>e.type===type).at(-1);}
  request(type,payload,meta={}){
    const last=this.messages.at(-1);
    const env={protocolVersion:'0.1',type,roomId:last?.roomId??'',sessionId:last?.sessionId??'',
      requestId:`r${this.messages.length}`,seq:this.messages.length,epoch:last?.epoch??1,payload,...meta};
    this.emit('message',Buffer.from(JSON.stringify(env)),false);return env;
  }
}
export async function localServer(t,options={}) {
  const root=await mkdtemp(join(tmpdir(),'engine-local-'));
  const server=createRoomServer({storageDir:root,...options});clearInterval(server.timer);
  t.after(async()=>{await server.close();await rm(root,{recursive:true,force:true});});
  const connect=(query='')=>{const ws=new LocalSocket();server.connect(ws,new URL(`http://localhost/ws${query}`));return ws;};
  const host=connect('?role=display'),room=server.rooms.get(host.take('room.status').roomId);
  host.request('room.join',{joinCode:room.code,name:'One',hero:'bari'});
  const phone=connect();phone.request('room.join',{joinCode:room.code,name:'Two',hero:'real_armor'});
  return {server,root,host,phone,room,connect};
}
export async function http(server,url,{method='GET',body}={}) {
  const request=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  request.url=url;request.method=method;request.headers={};
  let status=0,headers={},text='';
  const response={writeHead(code,values){status=code;headers=values;},end(value){text=value?.toString()??'';}};
  await server.handleHttp(request,response);
  return {status,headers,text,json:()=>JSON.parse(text)};
}
