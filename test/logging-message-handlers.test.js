import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageStore } from '../src/message-store.js';
import { createMessageLogHandlers } from '../src/logging/message-handlers.js';

const meta = { guildId: 'g1' };
const setup = ({ ignoredRoles = [] } = {}) => {
  const posts = [];
  const router = {
    post: async (guildId, category, payload, opts) => { posts.push({ guildId, category, payload, opts }); return 'sent'; },
    isIgnoredAuthor: (guildId, roleIds = []) => roleIds.some((id) => ignoredRoles.includes(id)),
  };
  const messageStore = createMessageStore({ now: () => 0 });
  const h = createMessageLogHandlers({ router, messageStore, now: () => 0 });
  return { posts, messageStore, h };
};
const stored = (over = {}) => ({
  id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'Sam',
  text: 'remembered', attachments: [], at: 0, authorRoleIds: ['r1'], ...over,
});
const partial = (over = {}) => ({
  id: 'm1', guildId: 'g1', channelId: 'c1', partial: true, content: null, author: null, member: null,
  attachments: new Map(), createdTimestamp: null, ...over,
});

test('a delete uses the text Lu remembered, and forgets it', async () => {
  const { posts, messageStore, h } = setup();
  messageStore.record(stored());
  await h.onDelete(partial(), meta);
  assert.equal(posts[0].category, 'messages');
  assert.equal(posts[0].payload.embeds[0].description, 'remembered');
  assert.deepEqual(posts[0].opts, { channelId: 'c1', authorRoleIds: ['r1'] });
  assert.equal(messageStore.get('m1'), null);
});

test('a delete Lu has no text for is still logged, as not available', async () => {
  const { posts, h } = setup();
  await h.onDelete(partial(), meta);
  assert.match(posts[0].payload.embeds[0].description, /not available/);
});

test("a bot's deleted message is not logged", async () => {
  const { posts, h } = setup();
  await h.onDelete(partial({ partial: false, content: 'beep', author: { id: 'b', bot: true, displayName: 'Bot' } }), meta);
  assert.equal(posts.length, 0);
});

test('an edit logs the remembered old text against the new text', async () => {
  const { posts, messageStore, h } = setup();
  messageStore.record(stored({ text: 'old' }));
  const after = { id: 'm1', guildId: 'g1', channelId: 'c1', content: 'new', author: { id: 'u1', bot: false, displayName: 'Sam' }, member: null };
  await h.onEdit([partial(), after], meta);
  const e = posts[0].payload.embeds[0];
  assert.equal(e.fields.find((f) => f.name === 'Before').value, 'old');
  assert.equal(e.fields.find((f) => f.name === 'After').value, 'new');
  assert.deepEqual(posts[0].opts, { channelId: 'c1', authorRoleIds: ['r1'] });
});

// Discord sends an update when a link preview loads or a message is pinned;
// the text has not changed, so there is nothing to log.
test('an update that does not change the text is not logged', async () => {
  const { posts, messageStore, h } = setup();
  messageStore.record(stored({ text: 'same' }));
  const after = { id: 'm1', guildId: 'g1', channelId: 'c1', content: 'same', author: { id: 'u1', bot: false, displayName: 'Sam' } };
  await h.onEdit([partial(), after], meta);
  assert.equal(posts.length, 0);
});

test("a bot's edit is not logged", async () => {
  const { posts, h } = setup();
  const after = { id: 'm1', guildId: 'g1', channelId: 'c1', content: 'new', author: { id: 'b', bot: true, displayName: 'Bot' } };
  await h.onEdit([partial(), after], meta);
  assert.equal(posts.length, 0);
});

test('an edit to a message Lu never saw falls back to the cached old text, or not available', async () => {
  const { posts, h } = setup();
  const author = { id: 'u1', bot: false, displayName: 'Sam' };
  await h.onEdit([{ ...partial(), partial: false, content: 'cached old' }, { id: 'm1', guildId: 'g1', channelId: 'c1', content: 'new', author }], meta);
  await h.onEdit([partial(), { id: 'm1', guildId: 'g1', channelId: 'c1', content: 'newer', author, editedTimestamp: 1 }], meta);
  assert.equal(posts[0].payload.embeds[0].fields.find((f) => f.name === 'Before').value, 'cached old');
  assert.match(posts[1].payload.embeds[0].fields.find((f) => f.name === 'Before').value, /not available/);
});

// discord.js emits messageUpdate for link previews, pins and threads too. For
// a message not in the store and a partial `before`, there is no old text and
// no editedTimestamp -- this was never an edit, so nothing is logged.
test('an update with no remembered text and no editedTimestamp is not logged', async () => {
  const { posts, h } = setup();
  const author = { id: 'u1', bot: false, displayName: 'Sam' };
  await h.onEdit([partial(), { id: 'm1', guildId: 'g1', channelId: 'c1', content: 'new', author }], meta);
  assert.equal(posts.length, 0);
});

test('a bulk delete is one entry, skips bots, and forgets what it logged', async () => {
  const { posts, messageStore, h } = setup();
  messageStore.record(stored({ id: 'm1', text: 'one' }));
  const messages = new Map([
    ['m1', partial({ id: 'm1' })],
    ['m2', partial({ id: 'm2' })],
    ['m3', partial({ id: 'm3', partial: false, content: 'beep', author: { id: 'b', bot: true, displayName: 'Bot' } })],
  ]);
  await h.onBulkDelete([messages, { id: 'c1', guildId: 'g1' }], meta);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.embeds[0].title, '2 messages deleted');
  assert.deepEqual(posts[0].opts, { channelId: 'c1' });
  assert.equal(messageStore.get('m1'), null);
});

test('a bulk delete of only bot messages logs nothing', async () => {
  const { posts, h } = setup();
  const messages = new Map([['m3', partial({ id: 'm3', partial: false, content: 'beep', author: { id: 'b', bot: true, displayName: 'Bot' } })]]);
  await h.onBulkDelete([messages, { id: 'c1', guildId: 'g1' }], meta);
  assert.equal(posts.length, 0);
});

// /log ignore @role must apply to a bulk purge too, not just single deletes.
test('a bulk delete drops entries from an ignored role', async () => {
  const { posts, messageStore, h } = setup({ ignoredRoles: ['mods'] });
  messageStore.record(stored({ id: 'm1', text: 'one', authorRoleIds: ['mods'] }));
  messageStore.record(stored({ id: 'm2', text: 'two', authorRoleIds: ['r1'] }));
  const messages = new Map([
    ['m1', partial({ id: 'm1' })],
    ['m2', partial({ id: 'm2' })],
  ]);
  await h.onBulkDelete([messages, { id: 'c1', guildId: 'g1' }], meta);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.embeds[0].title, '1 message deleted');
});

test('a bulk delete drops every entry from an ignored role and posts nothing', async () => {
  const { posts, messageStore, h } = setup({ ignoredRoles: ['mods'] });
  messageStore.record(stored({ id: 'm1', text: 'one', authorRoleIds: ['mods'] }));
  const messages = new Map([['m1', partial({ id: 'm1' })]]);
  await h.onBulkDelete([messages, { id: 'c1', guildId: 'g1' }], meta);
  assert.equal(posts.length, 0);
});

test('a deleted system message is not logged', async () => {
  const { posts, h } = setup();
  await h.onDelete(partial({ partial: false, content: 'Pin added', system: true, author: { id: 'u1', bot: false, displayName: 'Sam' } }), meta);
  assert.equal(posts.length, 0);
});

test('a system message inside a bulk delete is dropped', async () => {
  const { posts, h } = setup();
  const messages = new Map([
    ['m1', partial({ id: 'm1', partial: false, content: 'Pin added', system: true, author: { id: 'u1', bot: false, displayName: 'Sam' } })],
  ]);
  await h.onBulkDelete([messages, { id: 'c1', guildId: 'g1' }], meta);
  assert.equal(posts.length, 0);
});
