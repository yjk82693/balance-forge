import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from './scheduler.ts';

function timers(task) {
  let now = 0;
  let pending;
  const delays = [];
  const scheduler = createScheduler(task, {
    clock: () => now,
    setTimer: (callback, delay) => {
      delays.push(delay);
      pending = callback;
      return { unref() {} };
    },
    clearTimer: () => { pending = null; }
  });
  return {
    scheduler, delays,
    setTime: value => { now = value; },
    fire: () => pending(),
    pending: () => pending
  };
}
test('scheduler corrects callback work drift and skips stale deadlines without callback bursts', () => {
  let calls = 0;
  const timer = timers(() => {
    calls++;
    timer.setTime(calls === 1 ? 11 : 43);
  });
  assert.deepEqual(timer.delays, [8]);
  timer.setTime(8);
  timer.fire();
  assert.deepEqual(timer.delays, [8, 5]); // Next deadline is 16, not work completion + 8.
  timer.setTime(40);
  timer.fire();
  assert.equal(calls, 2);
  assert.deepEqual(timer.delays, [8, 5, 5]); // Skip deadlines 24, 32, 40; resume at 48.
  const stale = timer.pending();
  timer.scheduler.stop();
  assert.equal(timer.pending(), null);
  stale();
  assert.equal(calls, 2);
});
test('stopping inside a callback prevents rearming the scheduler', () => {
  const timer = timers(() => timer.scheduler.stop());
  timer.setTime(8);
  timer.fire();
  assert.deepEqual(timer.delays, [8]);
  assert.equal(timer.pending(), null);
});
