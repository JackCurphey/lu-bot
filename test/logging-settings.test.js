import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { createSettings } from '../src/settings.js';
import { createLogSettings, LOG_CATEGORIES } from '../src/logging/settings.js';

const fresh = () => createLogSettings(createSettings(openDatabase({ file: ':memory:' })));

test('the four categories, fixed', () => {
  assert.deepEqual([...LOG_CATEGORIES], ['messages', 'members', 'memberChanges', 'moderation']);
  assert.ok(Object.isFrozen(LOG_CATEGORIES));
});

test('a category is off until routed, and can be switched off again', () => {
  const s = fresh();
  assert.equal(s.route('g1', 'messages'), null);
  s.setRoute('g1', 'messages', 'c1');
  assert.equal(s.route('g1', 'messages'), 'c1');
  s.clearRoute('g1', 'messages');
  assert.equal(s.route('g1', 'messages'), null);
});

test('an unknown category is a programming error', () => {
  assert.throws(() => fresh().route('g1', 'voice'), /voice/);
});

test('several categories may share one channel, and it counts as a log channel', () => {
  const s = fresh();
  s.setRoute('g1', 'messages', 'c1');
  s.setRoute('g1', 'members', 'c1');
  assert.equal(s.isLogChannel('g1', 'c1'), true);
  assert.equal(s.isLogChannel('g1', 'c2'), false);
  assert.equal(s.isLogChannel('g2', 'c1'), false);
});

test('a broken route is switched off and remembers why; setting it again clears that', () => {
  const s = fresh();
  s.setRoute('g1', 'messages', 'c1');
  s.markBroken('g1', 'messages', { channelId: 'c1', reason: 'Unknown Channel', at: 5 });
  assert.equal(s.route('g1', 'messages'), null);
  assert.deepEqual(s.broken('g1', 'messages'), { channelId: 'c1', reason: 'Unknown Channel', at: 5 });
  s.setRoute('g1', 'messages', 'c2');
  assert.equal(s.broken('g1', 'messages'), null);
});

test('ignoring a channel or role, and undoing it', () => {
  const s = fresh();
  assert.equal(s.ignoreChannel('g1', 'c5'), true);
  assert.equal(s.ignoreChannel('g1', 'c5'), false);
  assert.equal(s.ignoreRole('g1', 'r1'), true);
  assert.equal(s.isIgnoredChannel('g1', 'c5'), true);
  assert.equal(s.isIgnoredRole('g1', 'r1'), true);
  assert.deepEqual(s.ignored('g1'), { channels: ['c5'], roles: ['r1'] });
  assert.equal(s.unignoreChannel('g1', 'c5'), true);
  assert.equal(s.unignoreChannel('g1', 'c5'), false);
  assert.equal(s.isIgnoredChannel('g1', 'c5'), false);
  assert.equal(s.unignoreRole('g1', 'r1'), true);
  assert.deepEqual(s.ignored('g1'), { channels: [], roles: [] });
});

test('ignore lists are per server', () => {
  const s = fresh();
  s.ignoreChannel('g1', 'c5');
  assert.equal(s.isIgnoredChannel('g2', 'c5'), false);
});
