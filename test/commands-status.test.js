import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStatusCommand } from '../src/commands/status.js';
import { createCommandRegistry } from '../src/commands/registry.js';

const run = async (cmd) => {
  const replies = [];
  await cmd.run({ view: {}, reply: async (body, opts = {}) => { replies.push({ body, opts }); } });
  return replies;
};

// Open to everyone (owner's call, 2026-09-27): it shows only the version and
// which switches are on, and a Manage Server default hid it from the person
// testing Lu. The moderation commands keep their permission limits.
test('lu-status is open to everyone', () => {
  const cmd = createStatusCommand({ version: '1.2', features: {}, databaseOk: true });
  assert.equal(cmd.name, 'lu-status');
  assert.equal(cmd.permission, null);
});

test('a member with no permissions can run lu-status, and Discord is told no default', async () => {
  const registry = createCommandRegistry();
  registry.register(createStatusCommand({ version: '1.2', features: {}, databaseOk: true }));
  assert.equal(registry.definitions()[0].default_member_permissions, undefined);
  const replies = [];
  await registry.handle(
    { commandName: 'lu-status', guildId: 'g1', channelId: 'c1', user: { id: 'u1', name: 'sam' }, memberPermissions: [], options: {} },
    { reply: async (body) => { replies.push(body); } },
  );
  assert.match(replies[0].content, /Lu v1\.2/);
});

test('lu-status reports the version, each switch and the database, privately', async () => {
  const cmd = createStatusCommand({
    version: '1.2',
    features: { moderation: true, logging: false, welcome: false, roleMenus: false },
    databaseOk: true,
  });
  const [r] = await run(cmd);
  assert.equal(r.opts.ephemeral ?? true, true);
  const text = r.body.content;
  assert.match(text, /v1\.2/);
  assert.match(text, /moderation: on/);
  assert.match(text, /logging: off/);
  assert.match(text, /welcome: off/);
  assert.match(text, /role menus: off/);
  assert.match(text, /database: ok/);
});

test('lu-status says when the database did not open', async () => {
  const [r] = await run(createStatusCommand({ version: '1.2', features: {}, databaseOk: false }));
  assert.match(r.body.content, /database: not available/);
});
