import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRoomServer } from './server.ts';
import type { RoomServer } from './server.ts';
import type { RoomServerOptions } from './types.ts';
import type { WebSocket as WsSocket } from 'ws';
// Exercises the production WebSocket handlers without opening a network listener.
export class LocalSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages: any[] = [];
  send(raw) {
    this.messages.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  take(type: string): any {
    return this.messages.filter(e => e.type === type).at(-1);
  }
  request(type: string, payload: unknown, meta: Record<string, unknown> = {}): any {
    const last = this.messages.at(-1);
    const env = {
      protocolVersion: '0.1',
      type,
      roomId: last?.roomId ?? '',
      sessionId: last?.sessionId ?? '',
      requestId: `r${this.messages.length}`,
      seq: this.messages.length,
      epoch: last?.epoch ?? 1,
      payload,
      ...meta
    };
    this.emit('message', Buffer.from(JSON.stringify(env)), false);
    return env;
  }
}
export async function localServer(t: any, options: RoomServerOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'engine-local-'));
  const server = createRoomServer({
    storageDir: root,
    analysisEnv: {},
    ...options
  });
  server.scheduler.stop();
  t.after(async () => {
    await server.close();
    await rm(root, {
      recursive: true,
      force: true
    });
  });
  const connect = (query = '') => {
    const ws = new LocalSocket();
    server.connect(ws as unknown as WsSocket, new URL(`http://localhost/ws${query}`));
    return ws;
  };
  const host = connect('?role=display'),
    room = server.rooms.get(host.take('room.status').roomId);
  host.request('room.join', {
    joinCode: room.code,
    name: 'One',
    hero: 'bari'
  });
  const phone = connect();
  phone.request('room.join', {
    joinCode: room.code,
    name: 'Two',
    hero: 'real_armor'
  });
  return {
    server,
    root,
    host,
    phone,
    room,
    connect
  };
}
export type HttpReply = { status: number; headers: Record<string, any>; text: string; json: () => any };
export async function http(server: RoomServer, url: string, {
  method = 'GET',
  body,
  raw
}: { method?: string; body?: unknown; raw?: string } = {}): Promise<HttpReply> {
  const bytes = raw ?? (body === undefined ? null : JSON.stringify(body));
  const request = Readable.from(bytes === null ? [] : [Buffer.from(bytes)]);
  Object.assign(request, { url, method, headers: {} });
  return new Promise<HttpReply>(resolve => {
    let status = 0,
      headers = {};
    const response = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead(code, values) {
        status = code;
        headers = values;
        this.headersSent = true;
      },
      end(value) {
        this.writableEnded = true;
        const text = value?.toString() ?? '';
        resolve({
          status,
          headers,
          text,
          json: () => JSON.parse(text)
        });
      },
      destroy() {
        this.destroyed = true;
        resolve({
          status,
          headers,
          text: '',
          json: () => null
        });
      }
    };
    server.http.emit('request', request, response);
  });
}
