import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, TimeoutError } from '../src/timeout.js';

// Timers are injected so tests decide when time "passes".
function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeoutImpl: (id) => { timers.delete(id); },
    fireAll() { const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); },
    count: () => timers.size,
  };
}

test('returns the result when the call finishes first, and clears its timer', async () => {
  const timers = fakeTimers();
  const out = await withTimeout(async () => 'done', 1000, timers);
  assert.equal(out, 'done');
  assert.equal(timers.count(), 0);
});

test('rejects with TimeoutError when time runs out, and aborts the call', async () => {
  const timers = fakeTimers();
  let seenSignal;
  const pending = withTimeout((signal) => { seenSignal = signal; return new Promise(() => {}); }, 1000, timers);
  timers.fireAll();
  await assert.rejects(pending, (err) => err instanceof TimeoutError && err.name === 'TimeoutError');
  assert.equal(seenSignal.aborted, true);
});

test('a call that fails before the timeout rejects with its own error', async () => {
  const timers = fakeTimers();
  await assert.rejects(
    withTimeout(async () => { throw new Error('boom'); }, 1000, timers),
    (err) => err.message === 'boom',
  );
  assert.equal(timers.count(), 0);
});
