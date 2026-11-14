import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch, rosterJobs } from './index.ts';
import { performance } from 'node:perf_hooks';
test('progress is monotonic, periodically streamed, and agrees with unchanged ordered final results', async () => {
  const jobs = rosterJobs({
      seeds: [1]
    }),
    updates = [],
    times = [];
  const streamed = await runBatch(jobs, {
    workers: 2,
    onProgress: p => {
      updates.push(p);
      times.push(performance.now());
    }
  });
  const plain = await runBatch(jobs, {
    workers: 2
  });
  assert.deepEqual(streamed.results, plain.results);
  assert.equal(updates[0].matchesDone, 0);
  assert.ok(updates.length >= 3);
  for (let i = 1; i < updates.length; i++) {
    assert.ok(updates[i].matchesDone >= updates[i - 1].matchesDone);
    assert.ok(updates[i].elapsedMs >= updates[i - 1].elapsedMs);
    if (i < updates.length - 1) assert.ok(times[i] - times[i - 1] >= 60);
  }
  const final = updates.at(-1);
  assert.equal(final.matchesDone, 30);
  assert.equal(final.totalMatches, 30);
  assert.equal(final.matchups.length, 15);
  assert.equal(final.matchups.reduce((n, r) => n + r.games, 0), 30);
  for (const row of final.matchups) {
    assert.equal(row.games, 2);
    assert.equal(Object.values(row.wins).reduce((a, b) => a + b, 0) + row.draws, 2);
  }
});
test('first-seat wins reconcile between each matchup row, progress totals and final run summary', async () => {
  const updates = [];
  const batch = await runBatch(rosterJobs({
    seeds: [3]
  }), {
    workers: 2,
    onProgress: progress => updates.push(progress)
  });
  for (const progress of updates) assert.equal(progress.seatWins, progress.matchups.reduce((sum, row) =>
    sum + row.seatWins, 0));
  const expected = batch.results.filter(result => result.valid && result.outcome.winners.includes(
    result.config.players[0])).length;
  assert.equal(batch.metrics.seatWins, expected);
});
