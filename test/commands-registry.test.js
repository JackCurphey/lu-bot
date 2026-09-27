import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { createCommandRegistry } from '../src/commands/registry.js';

const view = (over = {}) => ({
  commandName: 'ping', guildId: 'g1', channelId: 'c1', user: { id: 'u1', name: 'sam' },
  memberPermissions: [], options: {}, ...over,
});
const recordingIo = () => {
  const replies = [];
  return { replies, reply: async (body, opts = {}) => { replies.push({ body, ephemeral: opts.ephemeral ?? true }); } };
};

test('definitions carry the default permission as Discord expects it', () => {
  const r = createCommandRegistry();
  r.register({ name: 'ban', description: 'Ban someone', permission: 'BanMembers', run: async () => {} });
  r.register({ name: 'open', description: 'Anyone', permission: null, run: async () => {} });
  const [ban, open] = r.definitions();
  assert.equal(ban.name, 'ban');
  assert.equal(ban.default_member_permissions, PermissionFlagsBits.BanMembers.toString());
  assert.equal(open.default_member_permissions, undefined);
});

test('a command is routed to its handler', async () => {
  const r = createCommandRegistry();
  let seen = null;
  r.register({ name: 'ping', description: 'p', permission: null, run: async (ctx) => { seen = ctx.view.user.id; } });
  await r.handle(view(), recordingIo());
  assert.equal(seen, 'u1');
});

// The integration setting in Server Settings can be loosened by an admin. The
// re-check means that loosening can never let a member without the power use it.
test('the permission is re-checked, and a member without it is refused', async () => {
  const r = createCommandRegistry();
  let ran = false;
  r.register({ name: 'ban', description: 'b', permission: 'BanMembers', run: async () => { ran = true; } });
  const io = recordingIo();
  await r.handle(view({ commandName: 'ban', memberPermissions: ['SendMessages'] }), io);
  assert.equal(ran, false);
  assert.equal(io.replies.length, 1);
  assert.equal(io.replies[0].ephemeral, true);
  assert.match(io.replies[0].body.content, /Ban Members/);
});

test('Administrator passes every permission check', async () => {
  const r = createCommandRegistry();
  let ran = false;
  r.register({ name: 'ban', description: 'b', permission: 'BanMembers', run: async () => { ran = true; } });
  await r.handle(view({ commandName: 'ban', memberPermissions: ['Administrator'] }), recordingIo());
  assert.equal(ran, true);
});

test('commands are refused outside a server', async () => {
  const r = createCommandRegistry();
  let ran = false;
  r.register({ name: 'ping', description: 'p', permission: null, run: async () => { ran = true; } });
  const io = recordingIo();
  await r.handle(view({ guildId: null }), io);
  assert.equal(ran, false);
  assert.match(io.replies[0].body.content, /server/);
});

test('a handler that throws gets a private error reply, and the error does not escape', async () => {
  const r = createCommandRegistry();
  r.register({ name: 'ping', description: 'p', permission: null, run: async () => { throw new Error('kaboom'); } });
  const io = recordingIo();
  await r.handle(view(), io);
  assert.equal(io.replies[0].ephemeral, true);
  assert.match(io.replies[0].body.content, /went wrong/);
  assert.doesNotMatch(io.replies[0].body.content, /kaboom/);
});

test('an unknown command is answered, not ignored', async () => {
  const io = recordingIo();
  await createCommandRegistry().handle(view({ commandName: 'nope' }), io);
  assert.match(io.replies[0].body.content, /don't know/);
});

test('registering the same name twice is a programming error', () => {
  const r = createCommandRegistry();
  const c = { name: 'ping', description: 'p', permission: null, run: async () => {} };
  r.register(c);
  assert.throws(() => r.register(c), /already registered/);
});

test('an unknown permission name is a programming error', () => {
  assert.throws(
    () => createCommandRegistry().register({ name: 'x', description: 'x', permission: 'BanMember', run: async () => {} }),
    /BanMember/,
  );
});
