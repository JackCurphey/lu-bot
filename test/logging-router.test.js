import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { createSettings } from '../src/settings.js';
import { createLogSettings } from '../src/logging/settings.js';
import { createLogRouter } from '../src/logging/router.js';

const setup = (send) => {
  const logSettings = createLogSettings(createSettings(openDatabase({ file: ':memory:' })));
  logSettings.setRoute('g1', 'messages', 'log1');
  const posted = [];
  const router = createLogRouter({
    logSettings,
    send: send ?? (async (channelId, payload) => { posted.push([channelId, payload]); }),
    now: () => 7,
  });
  return { logSettings, router, posted };
};
const quiet = async (fn) => {
  const error = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = error; }
};

test('an entry goes to the category channel', async () => {
  const { router, posted } = setup();
  assert.equal(await router.post('g1', 'messages', { embeds: [] }, { channelId: 'c1' }), 'sent');
  assert.deepEqual(posted, [['log1', { embeds: [] }]]);
});

test('a category with no channel posts nothing', async () => {
  const { router, posted } = setup();
  assert.equal(await router.post('g1', 'members', { embeds: [] }), 'off');
  assert.equal(posted.length, 0);
});

test('messages from an ignored channel, a log channel, or an ignored role are skipped', async () => {
  const { router, posted, logSettings } = setup();
  logSettings.ignoreChannel('g1', 'staff');
  logSettings.ignoreRole('g1', 'mods');
  assert.equal(await router.post('g1', 'messages', {}, { channelId: 'staff' }), 'ignored');
  assert.equal(await router.post('g1', 'messages', {}, { channelId: 'log1' }), 'ignored');
  assert.equal(await router.post('g1', 'messages', {}, { channelId: 'c1', authorRoleIds: ['x', 'mods'] }), 'ignored');
  assert.equal(posted.length, 0);
});

test('a channel that is gone switches the route off once, with the reason kept', async () => {
  let calls = 0;
  const { router, logSettings } = setup(async () => {
    calls += 1;
    throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
  });
  assert.equal(await quiet(() => router.post('g1', 'messages', {}, { channelId: 'c1' })), 'broken');
  assert.equal(logSettings.route('g1', 'messages'), null);
  assert.deepEqual(logSettings.broken('g1', 'messages'), { channelId: 'log1', reason: 'Unknown Channel', at: 7 });
  assert.equal(await router.post('g1', 'messages', {}, { channelId: 'c1' }), 'off');
  assert.equal(calls, 1);
});

test('losing access also switches the route off', async () => {
  for (const code of [50001, 50013]) {
    const { router, logSettings } = setup(async () => { throw Object.assign(new Error('Missing'), { code }); });
    await quiet(() => router.post('g1', 'messages', {}, { channelId: 'c1' }));
    assert.equal(logSettings.route('g1', 'messages'), null, String(code));
  }
});

test('a passing failure is logged and the route stays on', async () => {
  const { router, logSettings } = setup(async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); });
  assert.equal(await quiet(() => router.post('g1', 'messages', {}, { channelId: 'c1' })), 'failed');
  assert.equal(logSettings.route('g1', 'messages'), 'log1');
});
