import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { createSettings } from '../src/settings.js';

const fresh = () => createSettings(openDatabase({ file: ':memory:' }));

test('an unset key returns the fallback', () => {
  assert.equal(fresh().get('g1', 'logging', 'channel', null), null);
  assert.equal(fresh().get('g1', 'logging', 'channel', 'x'), 'x');
});

test('values keep their type through the database', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', '123');
  s.set('g1', 'welcome', 'enabled', true);
  s.set('g1', 'joinroles', 'humans', ['1', '2']);
  s.set('g1', 'moderation', 'dm', { onWarn: false });
  assert.equal(s.get('g1', 'welcome', 'channel'), '123');
  assert.equal(s.get('g1', 'welcome', 'enabled'), true);
  assert.deepEqual(s.get('g1', 'joinroles', 'humans'), ['1', '2']);
  assert.deepEqual(s.get('g1', 'moderation', 'dm'), { onWarn: false });
});

test('set overwrites', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', '1');
  s.set('g1', 'welcome', 'channel', '2');
  assert.equal(s.get('g1', 'welcome', 'channel'), '2');
});

test('guilds and features do not see each other', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', 'a');
  assert.equal(s.get('g2', 'welcome', 'channel', null), null);
  assert.equal(s.get('g1', 'leave', 'channel', null), null);
});

test('remove clears a key back to the fallback', () => {
  const s = fresh();
  s.set('g1', 'welcome', 'channel', 'a');
  s.remove('g1', 'welcome', 'channel');
  assert.equal(s.get('g1', 'welcome', 'channel', 'none'), 'none');
});

test('all returns one feature of one guild as a plain object', () => {
  const s = fresh();
  s.set('g1', 'logging', 'messages', '10');
  s.set('g1', 'logging', 'members', '11');
  s.set('g1', 'welcome', 'channel', '12');
  assert.deepEqual(s.all('g1', 'logging'), { members: '11', messages: '10' });
});

test('undefined is refused rather than stored as nothing', () => {
  assert.throws(() => fresh().set('g1', 'welcome', 'channel', undefined), /undefined/);
});
