import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStatusCommand } from '../src/commands/status.js';

const run = async (cmd) => {
  const replies = [];
  await cmd.run({ view: {}, reply: async (body, opts = {}) => { replies.push({ body, opts }); } });
  return replies;
};

test('lu-status needs Manage Server by default', () => {
  const cmd = createStatusCommand({ version: '1.2', features: {}, databaseOk: true });
  assert.equal(cmd.name, 'lu-status');
  assert.equal(cmd.permission, 'ManageGuild');
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
