import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startScheduler } from './scheduler.ts';

test('a tick that is still running is not started twice', async () => {
  let calls = 0;
  let release: () => void = () => {};
  const scheduler = startScheduler(
    () => {
      calls += 1;
      return new Promise<void>((resolve) => (release = resolve));
    },
    60_000,
    { immediate: false }
  );
  const first = scheduler.tickNow();
  await scheduler.tickNow();
  assert.equal(calls, 1);
  release();
  await first;
  scheduler.stop();
});

test('an error is kept and cleared by the next good tick', async () => {
  let fail = true;
  const scheduler = startScheduler(
    async () => {
      if (fail) throw new Error('disk is full');
    },
    60_000,
    { immediate: false, now: () => new Date('2026-11-18T10:00:00Z') }
  );
  await scheduler.tickNow();
  assert.equal(scheduler.status().lastError, 'disk is full');
  assert.equal(scheduler.status().lastTickAt, '2026-11-18T10:00:00.000Z');
  fail = false;
  await scheduler.tickNow();
  assert.equal(scheduler.status().lastError, null);
  scheduler.stop();
});
