import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuildEvents, GUILD_EVENTS } from '../src/guild-events.js';

test('a handler receives events from a managed guild', async () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  const seen = [];
  ev.on('memberAdd', (payload, meta) => { seen.push([payload.id, meta.guildId]); });
  await ev.emit('memberAdd', 'g1', { id: 'u1' });
  assert.deepEqual(seen, [['u1', 'g1']]);
});

// Lu chats in a thread in another server (DISCORD_ALLOWED_CHANNELS), but
// server-wide features act only in DISCORD_ALLOWED_GUILDS.
test('events from other guilds are dropped', async () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  let calls = 0;
  ev.on('memberAdd', () => { calls += 1; });
  await ev.emit('memberAdd', 'g2', { id: 'u1' });
  await ev.emit('memberAdd', null, { id: 'u1' });
  assert.equal(calls, 0);
});

test('one failing handler does not stop the others or escape', async () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  let second = false;
  ev.on('banAdd', () => { throw new Error('first broke'); });
  ev.on('banAdd', async () => { second = true; });
  await ev.emit('banAdd', 'g1', {});
  assert.equal(second, true);
});

test('an unknown event name is a programming error', () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  assert.throws(() => ev.on('memberJoin', () => {}), /memberJoin/);
});

test('has() says whether anything listens, so unused events cost nothing', () => {
  const ev = createGuildEvents({ managedGuilds: ['g1'] });
  assert.equal(ev.has('messageDelete'), false);
  ev.on('messageDelete', () => {});
  assert.equal(ev.has('messageDelete'), true);
});

test('the event list is fixed', () => {
  assert.ok(Object.isFrozen(GUILD_EVENTS));
  assert.ok(GUILD_EVENTS.includes('auditLogEntry'));
});
