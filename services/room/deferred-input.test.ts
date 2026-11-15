import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer } from './test-helpers.ts';

test('a second real-time input for the same tick waits for the next tick instead of being dropped', async t => {
  const { server, host, room } = await localServer(t);
  host.request('match.start', { seed: 5, maxTicks: 20 });
  const move = (seq: number, moveX: number) => host.request('input.submit', {
    playerId: 'p1', seq, tick: 1, turnId: 0, actionId: 'move', params: { moveX, moveY: 0 }
  });
  move(1, 1000);
  move(2, 0);
  server.advance(room);
  server.advance(room);
  const receipts = room.authority.receipts;
  assert.ok(receipts.has(JSON.stringify(['p1', 1])));
  assert.ok(receipts.has(JSON.stringify(['p1', 2])));
});
