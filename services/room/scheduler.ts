import { performance } from 'node:perf_hooks';

// Keep a monotonic deadline rather than adding callback/work delays to every interval.
export function createScheduler(task: () => void, {
  intervalMs = 8,
  clock = () => performance.now(),
  setTimer = setTimeout as (callback: () => void, delay: number) => any,
  clearTimer = clearTimeout as (timer: any) => void
}: { intervalMs?: number; clock?: () => number; setTimer?: (callback: () => void, delay: number) => any;
  clearTimer?: (timer: any) => void } = {}) {
  let deadline = clock() + intervalMs;
  let active = true;
  let timer: any;
  function arm() {
    timer = setTimer(run, Math.max(1, Math.ceil(deadline - clock())));
    timer.unref?.();
  }
  function run() {
    if (!active) return;
    try {
      task();
    } finally {
      deadline += intervalMs;
      const now = clock();
      // The simulation accumulator handles catch-up; never burst stale scheduler callbacks.
      if (deadline <= now) deadline += (Math.floor((now - deadline) / intervalMs) + 1) * intervalMs;
      if (active) arm();
    }
  }
  arm();
  return {
    stop() {
      active = false;
      clearTimer(timer);
    }
  };
}
