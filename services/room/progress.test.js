import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localServer, http } from './test-helpers.js';
test('room server broadcasts worker progress and stores final results and their replays', async t => {
  const {
    server,
    host
  } = await localServer(t);
  const response = await http(server, '/v1/playtest/run', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 4
    }
  });
  assert.equal(response.status, 200);
  const updates = host.messages.filter(m => m.type === 'playtest.progress').map(m => m.payload);
  assert.ok(updates.length >= 2);
  assert.equal(updates.at(-1).matchesDone, 8);
  assert.equal(new Set(updates.map(p => p.runId)).size, 1);
  const results = (await http(server, response.json().resultsPath)).json();
  assert.equal(results.length, 8);
  assert.equal(updates.at(-1).matchups.reduce((n, r) => n + r.games, 0), 8);
  assert.ok((await http(server, `/v1/replay/${results[0].matchId}`)).json().frames.length > 0);
});
test('HTTP run summary and final progress carry the same first-seat win count', async t => {
  const {
    server,
    host
  } = await localServer(t);
  const response = await http(server, '/v1/playtest/run', {
    method: 'POST',
    body: {
      gameId: 'hero_arena',
      pairs: 2
    }
  });
  const summary = response.json(),
    results = (await http(server, summary.resultsPath)).json();
  const expected = results.filter(result => result.outcome.winners.includes(result.config.players[0])).length;
  assert.equal(summary.seatWins, expected);
  const final = host.take('playtest.progress').payload;
  assert.equal(final.seatWins, expected);
  assert.equal(final.matchups.reduce((sum, row) => sum + row.seatWins, 0), expected);
});
