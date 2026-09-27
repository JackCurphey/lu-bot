import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageStore } from '../src/message-store.js';

const msg = (id, over = {}) => ({
  id, guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'sam',
  text: `text ${id}`, attachments: [], at: 0, ...over,
});

test('a recorded message can be read back', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1'));
  assert.equal(s.get('1').text, 'text 1');
  assert.equal(s.get('missing'), null);
});

test('messages expire after the time limit', () => {
  let t = 0;
  const s = createMessageStore({ ttlMs: 1000, now: () => t });
  s.record(msg('1', { at: 0 }));
  t = 999;
  assert.ok(s.get('1'));
  t = 1001;
  assert.equal(s.get('1'), null);
});

test('the oldest message is dropped when the cap is reached', () => {
  const s = createMessageStore({ max: 2, now: () => 0 });
  s.record(msg('1'));
  s.record(msg('2'));
  s.record(msg('3'));
  assert.equal(s.get('1'), null);
  assert.ok(s.get('2'));
  assert.ok(s.get('3'));
  assert.equal(s.size(), 2);
});

test('an edit returns the text as it was and keeps the new text', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1', { text: 'before' }));
  assert.equal(s.updateText('1', 'after').text, 'before');
  assert.equal(s.get('1').text, 'after');
  assert.equal(s.updateText('missing', 'x'), null);
});

test('forget removes a message and hands it back', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1'));
  assert.equal(s.forget('1').id, '1');
  assert.equal(s.get('1'), null);
  assert.equal(s.forget('1'), null);
});

test("an author's recent messages come newest first, from that guild only", () => {
  const s = createMessageStore({ now: () => 10 });
  s.record(msg('1', { at: 1 }));
  s.record(msg('2', { at: 2, authorId: 'u2' }));
  s.record(msg('3', { at: 3, guildId: 'g2' }));
  s.record(msg('4', { at: 4 }));
  s.record(msg('5', { at: 5 }));
  assert.deepEqual(s.recentByAuthor('g1', 'u1', 2).map((m) => m.id), ['5', '4']);
});

test('expired messages are not returned as recent', () => {
  let t = 0;
  const s = createMessageStore({ ttlMs: 100, now: () => t });
  s.record(msg('1', { at: 0 }));
  t = 500;
  s.record(msg('2', { at: 500 }));
  assert.deepEqual(s.recentByAuthor('g1', 'u1', 5).map((m) => m.id), ['2']);
});

test('what is read back is a copy, not the stored record', () => {
  const s = createMessageStore({ now: () => 0 });
  s.record(msg('1'));
  s.get('1').text = 'tampered';
  assert.equal(s.get('1').text, 'text 1');
});
