import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runCli } from './startup.ts';
import { localServer, http } from './test-helpers.ts';
function runtime(env = {}): any {
  const signals = new EventEmitter(),
    output = {
      stdout: '',
      stderr: ''
    };
  return Object.assign(signals, {
    env,
    output,
    stdout: {
      write: text => {
        output.stdout += text;
      }
    },
    stderr: {
      write: text => {
        output.stderr += text;
      }
    }
  });
}
test('port-in-use startup exits nonzero, explains the remedy and closes partial server resources', async t => {
  const {
      server
    } = await localServer(t),
    processState = runtime({
      PORT: '34567'
    });
  server.http.listen = function () {
    queueMicrotask(() => this.emit('error', Object.assign(Error('address already in use'), {
      code: 'EADDRINUSE'
    })));
    return this;
  };
  const result = await runCli({
    runtime: processState,
    createServer: () => server
  });
  assert.equal(result, null);
  assert.equal(processState.exitCode, 1);
  assert.equal(server.closed, true);
  assert.match(processState.output.stderr, /Port 34567 is already in use/);
  assert.match(processState.output.stderr, /PORT/);
  assert.equal(processState.output.stdout, '');
  assert.doesNotMatch(processState.output.stderr, /\n\s+at /);
});
test('game catalog is ready within one second of the listening transition', async t => {
  const {
      server
    } = await localServer(t),
    processState = runtime({
      PORT: '34567'
    });
  let listeningAt;
  server.http.listen = function () {
    queueMicrotask(() => {
      listeningAt = performance.now();
      this.emit('listening');
    });
    return this;
  };
  server.http.address = () => ({
    port: 34567,
    address: '127.0.0.1',
    family: 'IPv4'
  });
  assert.equal(await runCli({
    runtime: processState,
    createServer: () => server
  }), server);
  const response = await http(server, '/v1/games');
  const elapsedMs = performance.now() - listeningAt;
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().map(game => game.gameId), ['hero_arena', 'hero_cards']);
  assert.ok(elapsedMs < 1000, `Catalog response after listening: ${elapsedMs.toFixed(2)} ms`);
  t.diagnostic(`Catalog response after in-memory listening: ${elapsedMs.toFixed(2)} ms (no TCP listener).`);
  assert.equal(processState.exitCode, 0);
  assert.match(processState.output.stdout, /localhost:34567/);
  assert.equal(processState.listenerCount('SIGINT'), 1);
  assert.equal(processState.listenerCount('SIGTERM'), 1);
});
test('actual CLI entry exits nonzero for an invalid port without creating server state', async () => {
  const run = promisify(execFile);
  await assert.rejects(run(process.execPath, [fileURLToPath(new URL('./cli.ts', import.meta.url))], {
    env: {
      ...process.env,
      PORT: 'invalid'
    },
    timeout: 3000
  }), (error: any) => error.code === 1 && /Invalid PORT/.test(error.stderr) && !/\n\s+at /.test(error.stderr));
});
test('listener-permission failures have readable messages and shutdown errors keep a failure exit code', async () => {
  const denied = runtime();
  await runCli({
    runtime: denied,
    createServer: () => ({
      listen: async () => {
        throw Object.assign(Error('denied'), {
          code: 'EPERM'
        });
      },
      close: async () => {}
    })
  });
  assert.equal(denied.exitCode, 1);
  assert.match(denied.output.stderr, /EPERM.*permissions/);
  const healthy = runtime();
  await runCli({
    runtime: healthy,
    createServer: () => ({
      listen: async () => ({
        port: 3000
      }),
      close: async () => {
        throw Error('write error');
      }
    })
  });
  healthy.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(healthy.exitCode, 1);
  assert.match(healthy.output.stderr, /shutdown/);
});
test('invalid port spellings fail before constructing server resources', async () => {
  for (const PORT of ['', ' ', '0x10', '3e3', '-1', '65536']) {
    const state = runtime({ PORT });
    let created = false;
    assert.equal(await runCli({
      runtime: state,
      createServer: () => { created = true; }
    }), null);
    assert.equal(created, false);
    assert.equal(state.exitCode, 1);
    assert.match(state.output.stderr, /Invalid PORT/);
  }
});
test('shutdown forces a failure exit at three seconds if close never finishes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = runtime(), exits = [];
  let closes = 0;
  state.exit = code => exits.push(code);
  await runCli({
    runtime: state,
    createServer: () => ({
      listen: async () => ({ port: 3000 }),
      close: () => { closes++; return new Promise(() => {}); }
    })
  });
  state.emit('SIGTERM');
  state.emit('SIGINT');
  t.mock.timers.tick(2999);
  assert.deepEqual(exits, []);
  t.mock.timers.tick(1);
  assert.deepEqual(exits, [1]);
  assert.equal(closes, 1);
  assert.match(state.output.stderr, /shutdown exceeded 3 seconds; forcing exit/);
});
test('completed shutdown cancels the forced-exit deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = runtime(), exits = [];
  state.exit = code => exits.push(code);
  await runCli({
    runtime: state,
    createServer: () => ({ listen: async () => ({ port: 3000 }), close: async () => {} })
  });
  state.emit('SIGINT');
  await Promise.resolve();
  t.mock.timers.tick(3000);
  assert.deepEqual(exits, []);
  assert.equal(state.exitCode, 0);
  assert.equal(state.output.stderr, '');
});
test('server closes active HTTP connections before closing its listener', async t => {
  const { server } = await localServer(t);
  const calls = [];
  Object.defineProperty(server.http, 'listening', { configurable: true, get: () => true });
  server.http.closeAllConnections = () => calls.push('connections');
  server.http.close = ((callback: () => void) => { calls.push('listener'); callback(); }) as any;
  await server.close();
  assert.deepEqual(calls, ['connections', 'listener']);
});
test('close() drops open HTTP connections before it waits for http.close()', async t => {
  const { server } = await localServer(t);
  const order = [];
  server.http.closeAllConnections = () => order.push('closeAllConnections');
  Object.defineProperty(server.http, 'listening', { value: true, configurable: true });
  server.http.close = ((callback: () => void) => {
    order.push('close');
    callback();
  }) as any;
  await server.close();
  assert.deepEqual(order, ['closeAllConnections', 'close']);
  Object.defineProperty(server.http, 'listening', { value: false, configurable: true });
});
