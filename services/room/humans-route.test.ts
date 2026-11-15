import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http } from './test-helpers.ts';

test('GET /v1/humans/:gameId lists the human rows of that game only, and an unknown game is not found', async t => {
  const { server, host, room } = await localServer(t);
  const empty = await http(server, '/v1/humans/hero_arena');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json(), { gameId: 'hero_arena', humanMatches: 0, rows: [] });
  host.request('match.start', { maxTicks: 2 });
  server.advance(room);
  server.advance(room);
  const arena = (await http(server, '/v1/humans/hero_arena')).json();
  assert.equal(arena.gameId, 'hero_arena');
  assert.ok(Array.isArray(arena.rows));
  assert.equal(arena.humanMatches, arena.rows.length ? arena.humanMatches : 0);
  assert.ok(arena.rows.every(row => row.dimension.startsWith('human')));
  assert.deepEqual((await http(server, '/v1/humans/hero_cards')).json(),
    { gameId: 'hero_cards', humanMatches: 0, rows: [] }); // another game's matches do not leak in
  assert.equal((await http(server, '/v1/humans/nope')).status, 404);
});
