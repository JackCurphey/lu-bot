import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, toChatTurns } from '../src/history.js';

let n = 0;
const entry = (over = {}) => {
  n++;
  return {
    messageId: `m${n}`, channelId: 'chan', authorId: 'sam', name: 'sam',
    isBot: false, isLu: false, mentionsLu: false, mentionsOthers: false,
    repliesToLu: false, repliesToOther: false, at: n, text: `message ${n}`, ...over,
  };
};

test('records entries per channel, oldest first', () => {
  const h = createHistory();
  const a = entry(); const b = entry(); const c = entry({ channelId: 'other' });
  h.record(a); h.record(b); h.record(c);
  assert.deepEqual(h.entries('chan').map((e) => e.messageId), [a.messageId, b.messageId]);
  assert.deepEqual(h.entries('other').map((e) => e.messageId), [c.messageId]);
});

test('an unknown channel has no entries', () => {
  assert.deepEqual(createHistory().entries('nowhere'), []);
});

test('entries() returns a copy the caller cannot use to change history', () => {
  const h = createHistory();
  h.record(entry());
  h.entries('chan').push(entry());
  assert.equal(h.entries('chan').length, 1);
});

// --- Batch trimming ------------------------------------------------------------
//
// Dropping one old message per new message would change the start of every
// reply prompt, so the model server could never reuse text it already read.
// Trimming in batches keeps the start stable between trims.

test('holds up to the limit without trimming', () => {
  const h = createHistory({ limit: 20, trimTo: 10 });
  for (let i = 0; i < 20; i++) h.record(entry());
  assert.equal(h.entries('chan').length, 20);
});

test('the message past the limit trims to the newest trimTo, itself included', () => {
  const h = createHistory({ limit: 20, trimTo: 10 });
  const all = [];
  for (let i = 0; i < 21; i++) { const e = entry(); all.push(e); h.record(e); }
  const kept = h.entries('chan');
  assert.equal(kept.length, 10);
  assert.equal(kept.at(-1).messageId, all[20].messageId);
  assert.equal(kept[0].messageId, all[11].messageId);
});

// --- Chat turns ----------------------------------------------------------------

test('toChatTurns names everyone except Lu, whose lines are his own', () => {
  const turns = toChatTurns([
    entry({ name: 'ana', text: 'what about taiwan' }),
    entry({ name: 'Lu', isLu: true, isBot: true, text: 'what about it' }),
    entry({ name: 'otherbot', isBot: true, text: 'beep' }),
  ]);
  assert.deepEqual(turns, [
    { role: 'user', content: 'ana: what about taiwan' },
    { role: 'assistant', content: 'what about it' },
    { role: 'user', content: 'otherbot: beep' },
  ]);
});
