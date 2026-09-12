import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPauser } from '../src/pause.js';

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

function setup() {
  const timers = fakeTimers();
  const settled = [];
  const pauser = createPauser({ ms: 3000, onSettled: (ch, entry) => settled.push([ch, entry.messageId]), ...timers });
  return { timers, settled, pauser };
}

test('nothing is judged until the pause ends', () => {
  const { pauser, settled } = setup();
  pauser.wait('chan', { messageId: 'a' });
  assert.deepEqual(settled, []);
  assert.equal(pauser.pending('chan'), true);
});

test('when the pause ends, the waiting message is handed on', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('chan', { messageId: 'a' });
  timers.fireAll();
  assert.deepEqual(settled, [['chan', 'a']]);
  assert.equal(pauser.pending('chan'), false);
});

test('a new message restarts the pause, and only the latest is handed on', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('chan', { messageId: 'a' });
  const replaced = pauser.wait('chan', { messageId: 'b' });
  assert.equal(replaced.messageId, 'a');
  assert.equal(timers.count(), 1);
  timers.fireAll();
  assert.deepEqual(settled, [['chan', 'b']]);
});

test('cancel stops the pause and returns what was waiting', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('chan', { messageId: 'a' });
  assert.equal(pauser.cancel('chan').messageId, 'a');
  timers.fireAll();
  assert.deepEqual(settled, []);
  assert.equal(pauser.cancel('chan'), null);
});

test('channels pause independently', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('one', { messageId: 'a' });
  pauser.wait('two', { messageId: 'b' });
  pauser.cancel('one');
  timers.fireAll();
  assert.deepEqual(settled, [['two', 'b']]);
});
