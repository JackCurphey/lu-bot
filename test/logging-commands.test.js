import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { createSettings } from '../src/settings.js';
import { createLogSettings } from '../src/logging/settings.js';
import { createLogCommand } from '../src/logging/commands.js';

const setup = (send, missingPermissions) => {
  const logSettings = createLogSettings(createSettings(openDatabase({ file: ':memory:' })));
  const sent = [];
  const cmd = createLogCommand({
    logSettings,
    send: send ?? (async (channelId, payload) => { sent.push([channelId, payload]); }),
    missingPermissions: missingPermissions ?? (async () => []),
  });
  const run = async (subcommand, options = {}) => {
    const replies = [];
    await cmd.run({ view: { guildId: 'g1', subcommand, options }, reply: async (body) => { replies.push(body.content); } });
    return replies[0];
  };
  return { logSettings, sent, cmd, run };
};

test('/log needs Manage Server and has five sub-commands', () => {
  const { cmd } = setup();
  assert.equal(cmd.name, 'log');
  assert.equal(cmd.permission, 'ManageGuild');
  assert.deepEqual(cmd.options.map((o) => o.name), ['channel', 'off', 'ignore', 'unignore', 'status']);
  const category = cmd.options[0].options.find((o) => o.name === 'category');
  assert.deepEqual(category.choices.map((c) => c.value), ['messages', 'members', 'memberChanges', 'moderation']);
});

test('/log channel posts a test line there first, then saves the route', async () => {
  const { logSettings, sent, run } = setup();
  const reply = await run('channel', { category: 'messages', channel: { id: 'c9', name: 'logs' } });
  assert.equal(sent[0][0], 'c9');
  assert.match(sent[0][1].content, /Message logs will be posted here/);
  assert.equal(logSettings.route('g1', 'messages'), 'c9');
  assert.match(reply, /Message logs will go to <#c9>/);
});

test('/log channel does not save a channel Lu cannot post in', async () => {
  const { logSettings, run } = setup(async () => { throw new Error('Missing Access'); });
  const reply = await run('channel', { category: 'messages', channel: { id: 'c9', name: 'logs' } });
  assert.equal(logSettings.route('g1', 'messages'), null);
  assert.match(reply, /can't post in <#c9>/);
});

test('/log channel refuses a channel Lu lacks Attach Files in, without sending the test line', async () => {
  const sent = [];
  const send = async (channelId, payload) => { sent.push([channelId, payload]); };
  const { logSettings, run } = setup(send, async () => ['AttachFiles']);
  const reply = await run('channel', { category: 'messages', channel: { id: 'c9', name: 'logs' } });
  assert.match(reply, /Attach Files/);
  assert.equal(sent.length, 0);
  assert.equal(logSettings.route('g1', 'messages'), null);
});

test('/log channel proceeds as today when nothing is missing', async () => {
  const { logSettings, sent, run } = setup(undefined, async () => []);
  const reply = await run('channel', { category: 'messages', channel: { id: 'c9', name: 'logs' } });
  assert.equal(sent[0][0], 'c9');
  assert.equal(logSettings.route('g1', 'messages'), 'c9');
  assert.match(reply, /Message logs will go to <#c9>/);
});

test('/log off stops a category', async () => {
  const { logSettings, run } = setup();
  logSettings.setRoute('g1', 'members', 'c9');
  assert.match(await run('off', { category: 'members' }), /Member logs are off/);
  assert.equal(logSettings.route('g1', 'members'), null);
});

test('/log ignore and unignore take exactly one of a channel or a role', async () => {
  const { logSettings, run } = setup();
  assert.match(await run('ignore', {}), /one channel or one role/);
  assert.match(await run('ignore', { channel: { id: 'c1', name: 'a' }, role: { id: 'r1', name: 'b' } }), /one channel or one role/);
  assert.match(await run('ignore', { channel: { id: 'c1', name: 'staff' } }), /no longer log messages from <#c1>/);
  assert.match(await run('ignore', { role: { id: 'r1', name: 'Mods' } }), /no longer log messages from <@&r1>/);
  assert.match(await run('ignore', { role: { id: 'r1', name: 'Mods' } }), /already/);
  assert.deepEqual(logSettings.ignored('g1'), { channels: ['c1'], roles: ['r1'] });
  assert.match(await run('unignore', { channel: { id: 'c1', name: 'staff' } }), /will log messages from <#c1> again/);
  assert.match(await run('unignore', { channel: { id: 'c1', name: 'staff' } }), /wasn't ignoring/);
});

test('/log status lists each category, broken routes, ignores, and what is not shown yet', async () => {
  const { logSettings, run } = setup();
  logSettings.setRoute('g1', 'messages', 'c9');
  logSettings.setRoute('g1', 'members', 'c8');
  logSettings.markBroken('g1', 'members', { channelId: 'c8', reason: 'Missing Access', at: 0 });
  logSettings.ignoreChannel('g1', 'c1');
  const text = await run('status');
  assert.match(text, /Message logs: <#c9>/);
  assert.match(text, /Member logs: off, switched off after an error in <#c8> \(Missing Access\)/);
  assert.match(text, /Member change logs: off/);
  assert.match(text, /Moderation logs: off/);
  assert.match(text, /Ignored channels: <#c1>/);
  assert.match(text, /Ignored roles: none/);
  assert.match(text, /Moderation logs start when moderation is switched on\./);
  assert.match(text, /Who deleted a message or changed a member is not shown yet\./);
});
