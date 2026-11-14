import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeJson } from './storage.js';
import { localServer, http } from './test-helpers.js';
const redactedSeatToken = 'REDACTED_PRIVATE_SEAT_TOKEN_00000000';
const redactedHostToken = 'REDACTED_PRIVATE_HOST_TOKEN_00000000';

// Capture real route/message handlers and worker results without creating any network listener.
export async function collectExamples() {
  const cleanup = [];
  const {
    server,
    host,
    phone,
    room,
    root,
    connect
  } = await localServer({
    after: fn => cleanup.push(fn)
  });
  const examples = {
    note: 'Protocol examples from a two-tick local handler run; not demo balance results. Tokens are redacted.',
    http: {},
    websocket: {
      client: {},
      server: {}
    }
  };
  const capture = async (name, path, options) => {
    const response = await http(server, path, options);
    const json = response.headers['content-type']?.includes('application/json');
    examples.http[name] = {
      method: options?.method ?? 'GET',
      path,
      ...(options?.body ? {
        request: options.body
      } : {}),
      response: {
        status: response.status,
        body: json ? response.json() : response.text
      }
    };
    return json ? response.json() : response.text;
  };
  const request = (socket, type, payload) => {
    const envelope = socket.request(type, payload);
    examples.websocket.client[type] = envelope;
    return envelope;
  };
  try {
    await capture('games', '/v1/games');
    await capture('createRoom', '/v1/rooms', {
      method: 'POST',
      body: {
        gameId: 'hero_arena'
      }
    });
    const original = await capture('data', '/v1/data/hero_arena');
    request(phone, 'room.join', {
      joinCode: room.code,
      name: 'Two',
      hero: 'real_armor'
    });
    examples.websocket.server['room.status'] = phone.take('room.status');
    request(host, 'game.select', {
      gameId: 'hero_arena',
      dataHash: original.dataHash
    });
    request(host, 'ping', {});
    examples.websocket.server.pong = host.take('pong');
    request(host, 'match.start', {
      seed: 1,
      maxTicks: 2
    });
    examples.websocket.server['match.started'] = host.take('match.started');
    const token = phone.take('room.status').payload.seatToken;
    phone.close();
    const replacement = connect();
    request(replacement, 'reconnect', {
      joinCode: room.code,
      seatToken: token
    });
    request(host, 'input.submit', {
      playerId: 'p1',
      seq: 0,
      tick: 1,
      turnId: 0,
      actionId: 'move',
      params: {
        moveX: 1000,
        moveY: 0
      }
    });
    examples.websocket.server['input.ack'] = host.take('input.ack');
    server.advance(room);
    examples.websocket.server['state.view'] = host.take('state.view');
    examples.websocket.server['actions.available'] = host.take('actions.available');
    server.advance(room);
    examples.websocket.server['match.ended'] = host.take('match.ended');
    await capture('replay', `/v1/replay/${room.matchId}`);
    await capture('views', `/v1/replay/${room.matchId}/views?every=6`);
    await capture('full', '/v1/playtest/full', {
      method: 'POST',
      body: {
        gameId: 'hero_arena',
        pairs: 1,
        holdoutPairs: 1
      }
    });
    request(host, 'match.reset', {});
    host.request('unsupported.message', {});
    examples.websocket.server.error = host.take('error');
    request(connect(), 'room.create', {
      gameId: 'hero_cards'
    });
    await capture('applyPatch', '/v1/data/hero_arena/apply-patch', {
      method: 'POST',
      body: {
        proposal: {
          baseDataHash: original.dataHash,
          replacements: [{
            path: '/moves/1/power',
            value: 72
          }],
          rationale: 'Protocol example only; not a balance recommendation.'
        }
      }
    });
    await capture('retainedData', `/v1/data/hero_arena?dataHash=${original.dataHash}`);
    const run = await capture('playtest', '/v1/playtest/run', {
      method: 'POST',
      body: {
        gameId: 'hero_arena',
        pairs: 1
      }
    });
    examples.websocket.server['playtest.progress'] = host.take('playtest.progress');
    await capture('results', run.resultsPath);
    const dist = join(root, 'dist');
    await mkdir(dist);
    await writeFile(join(dist, 'index.html'), '<h1>Protocol example</h1>');
    server.staticDir = dist;
    await capture('static', '/');
    await capture('staticHead', '/', {
      method: 'HEAD'
    });
    return JSON.parse(JSON.stringify(examples, (key, value) => key === 'seatToken' ?
      redactedSeatToken : key === 'hostToken' ? redactedHostToken : value));
  } finally {
    for (const finish of cleanup.reverse()) await finish();
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeJson(fileURLToPath(new URL('./examples.json', import.meta.url)), await collectExamples());
}
