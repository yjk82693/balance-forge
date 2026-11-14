import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { localServer, http } from './test-helpers.js';
import { hash } from '../../packages/contracts/index.js';
test('HTTP listener serves static files and keeps patched data and running matches on separate immutable pins',
  async t => {
  const {
    server,
    host,
    room,
    root
  } = await localServer(t);
  const dist = join(root, 'dist');
  await mkdir(dist);
  server.staticDir = dist;
  await writeFile(join(dist, 'index.html'), '<h1>Ready</h1>');
  assert.match((await http(server, '/')).text, /Ready/);
  assert.match((await http(server, '/lobby')).text, /Ready/);
  await writeFile(join(root, 'private.txt'), 'private');
  await symlink(join(root, 'private.txt'), join(dist, 'escape.txt'));
  assert.equal((await http(server, '/escape.txt')).status, 403);
  const original = (await http(server, '/v1/data/hero_arena')).json();
  host.request('match.start', {
    maxTicks: 2
  });
  const proposal = {
    baseDataHash: original.dataHash,
    replacements: [{
      path: '/moves/1/power',
      value: 72
    }],
    rationale: 'holdout'
  };
  const changed = (await http(server, '/v1/data/hero_arena/apply-patch', {
    method: 'POST',
    body: {
      proposal
    }
  })).json();
  assert.notEqual(changed.dataHash, original.dataHash);
  assert.equal(room.authority.config.dataHash, original.dataHash);
  assert.equal(hash(room.authority.data), original.dataHash);
  assert.deepEqual((await http(server, `/v1/data/hero_arena?dataHash=${original.dataHash}`)).json(), original);
  assert.equal((await http(server, '/v1/data/hero_arena')).json().data.moves[1].power, 72);
  server.advance(room);
  server.advance(room);
  assert.equal(server.storage.humans[0].config.dataHash, original.dataHash);
  assert.throws(() => server.storage.recordReplay({
    ...server.storage.getReplay(room.matchId),
    seed: 99
  }));
  const bad = await http(server, '/v1/data/hero_arena/apply-patch', {
    method: 'POST',
    body: {
      proposal: {
        ...proposal,
        replacements: [{
          path: '/moves/1/script',
          value: 1
        }]
      }
    }
  });
  assert.equal(bad.status, 400);
  assert.equal(server.storage.current.get('hero_arena'), changed.dataHash);
});
