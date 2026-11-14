import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRoomServer } from './server.js';
import { LocalSocket } from './test-helpers.js';
import { chooseActions, deriveBotSeed } from '../../packages/games/action/bot.js';
const directory = await mkdtemp(join(tmpdir(), 'room-timing-'));
const server = createRoomServer({ storageDir: directory, analysisEnv: {} });
const intervals = [], sizes = [], ticks = [];
let previous, lastInput = -1;
function phone(query = '') {
  const socket = new LocalSocket();
  const send = socket.send.bind(socket);
  socket.send = raw => {
    if (JSON.parse(raw).type === 'state.view') sizes.push(Buffer.byteLength(raw));
    send(raw);
  };
  server.connect(socket, new URL(`http://localhost/ws${query}`));
  return socket;
}
try {
  const first = phone('?role=display'), room = server.rooms.get(first.take('room.status').roomId);
  first.request('room.join', { joinCode: room.code, name: 'One', hero: 'bari' });
  const second = phone();
  second.request('room.join', { joinCode: room.code, name: 'Two', hero: 'real_armor' });
  first.request('match.start', { seed: 91, maxTicks: 1800 });
  const pump = server.pump.bind(server), advance = server.advance.bind(server);
  server.advance = (...args) => { ticks.push(performance.now()); return advance(...args); };
  server.pump = () => {
    const now = performance.now();
    if (previous !== undefined) intervals.push(now - previous);
    previous = now;
    if (room.phase === 'playing' && lastInput !== room.authority.state.tick) {
      lastInput = room.authority.state.tick;
      for (const [index, socket] of [first, second].entries()) {
        const view = room.game.observe(room.authority.state, `p${index + 1}`);
        for (const input of chooseActions(view, view.tick * 2, deriveBotSeed(91, index))) {
          socket.request('input.submit', input);
        }
      }
    }
    pump();
  };
  const start = performance.now();
  await new Promise(resolve => setTimeout(resolve, 10000));
  const summary = values => ({ count: values.length, min: Math.min(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) });
  console.log(JSON.stringify({ elapsedMs: performance.now() - start, pumpIntervalMs: summary(intervals),
    simulationIntervalMs: summary(ticks.slice(1).map((time, index) => time - ticks[index])),
    stateViewUtf8Bytes: summary(sizes), finalTick: room.authority.state.tick,
    phase: room.phase, failures: server.failures }));
} finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
