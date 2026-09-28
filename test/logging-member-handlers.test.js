import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberLogHandlers } from '../src/logging/member-handlers.js';

const meta = { guildId: 'g1' };
const setup = () => {
  const posts = [];
  const router = { post: async (guildId, category, payload, opts) => { posts.push({ category, payload, opts }); return 'sent'; } };
  return { posts, h: createMemberLogHandlers({ router, now: () => 0 }) };
};
const member = (over = {}) => ({
  id: 'u1', partial: false, nickname: null, displayName: 'Sam', guild: { id: 'g1' },
  user: { id: 'u1', bot: false, username: 'sam', displayName: 'Sam', createdTimestamp: 0 },
  roles: { cache: new Map([['g1', {}], ['r1', {}]]) },
  ...over,
});
const title = (p) => p.payload.embeds[0].title;

test('a join is logged to members', async () => {
  const { posts, h } = setup();
  await h.onJoin(member(), meta);
  assert.equal(posts[0].category, 'members');
  assert.equal(title(posts[0]), 'Member joined');
});

test('a leave lists the roles held, without @everyone', async () => {
  const { posts, h } = setup();
  await h.onLeave(member(), meta);
  assert.equal(posts[0].category, 'members');
  assert.equal(posts[0].payload.embeds[0].fields[0].value, '<@&r1>');
});

test('a leave by an uncached member says the roles are not known', async () => {
  const { posts, h } = setup();
  await h.onLeave(member({ partial: true, roles: { cache: new Map() } }), meta);
  assert.match(posts[0].payload.embeds[0].fields[0].value, /not known/);
});

test('a nickname change is logged to member changes', async () => {
  const { posts, h } = setup();
  await h.onUpdate([member(), member({ nickname: 'Sammy' })], meta);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].category, 'memberChanges');
  assert.equal(title(posts[0]), 'Nickname changed');
});

test('added and removed roles are one entry', async () => {
  const { posts, h } = setup();
  const after = member({ roles: { cache: new Map([['g1', {}], ['r2', {}]]) } });
  await h.onUpdate([member(), after], meta);
  assert.equal(posts.length, 1);
  const fields = posts[0].payload.embeds[0].fields;
  assert.equal(fields.find((f) => f.name === 'Added').value, '<@&r2>');
  assert.equal(fields.find((f) => f.name === 'Removed').value, '<@&r1>');
});

test('a nickname and a role change together are two entries', async () => {
  const { posts, h } = setup();
  const after = member({ nickname: 'Sammy', roles: { cache: new Map([['g1', {}], ['r1', {}], ['r2', {}]]) } });
  await h.onUpdate([member(), after], meta);
  assert.deepEqual(posts.map(title), ['Nickname changed', 'Roles changed']);
});

// Discord also sends member updates for avatar, boost and timeout changes.
test('an update with no nickname or role change logs nothing', async () => {
  const { posts, h } = setup();
  await h.onUpdate([member(), member()], meta);
  assert.equal(posts.length, 0);
});

// With no "before" (an uncached member), a change cannot be told from no change.
test('an update with an uncached before logs nothing rather than guessing', async () => {
  const { posts, h } = setup();
  await h.onUpdate([member({ partial: true, nickname: null, roles: { cache: new Map() } }), member({ nickname: 'Sammy' })], meta);
  assert.equal(posts.length, 0);
});
