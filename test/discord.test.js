import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayIntentBits, Partials, MessageFlags, ApplicationCommandOptionType } from 'discord.js';
import { shouldObserve, toEntry, createChannelIo, LU_NAME, truncateForDiscord, DISCORD_REPLY_LIMIT, startTyping, TYPING_REFRESH_MS, intentsFor, partialsFor, interactionView, createInteractionIo, messageRecordOf, registerGuildCommands, createMessageUpdateHandler, sendToChannel, missingChannelPermissions, warmMemberCaches } from '../src/discord.js';
import { createMessageStore } from '../src/message-store.js';

// --- Old Lu stage 1: hear everything in allowed channels ------------------------
//
// Lu follows the conversation, so the adapter passes on every message in an
// allowed channel — other bots included (they are heard, never answered; that
// rule lives in attention.js). Only his own messages and other channels are
// dropped here.

const opts = { botId: 'bot', allowedChannels: ['chan'] };
const view = (over = {}) => ({
  id: 'm1', channelId: 'chan', author: { id: 'human', bot: false, displayName: 'sam' },
  content: 'hello', mentionedUsers: [], repliedUserId: null, createdTimestamp: 1000,
  guildId: 'g1', ...over,
});

// --- Server allowlist ---
// Listing every channel by id goes stale the moment someone adds a channel.
// A server allowlist says "everywhere in these servers", and the denylist is
// how a mod or private channel is kept out. The two mechanisms union: an
// explicitly allowed channel is still observed even outside an allowed server,
// so the old configuration keeps working unchanged.

const guildOpts = { botId: 'bot', allowedChannels: [], allowedGuilds: ['g1'], deniedChannels: [] };

test('every channel in an allowed server is observed', () => {
  assert.equal(shouldObserve(view({ channelId: 'anything', guildId: 'g1' }), guildOpts), true);
  assert.equal(shouldObserve(view({ channelId: 'another', guildId: 'g1' }), guildOpts), true);
});

test('a channel in a server that is not allowed is ignored', () => {
  assert.equal(shouldObserve(view({ channelId: 'anything', guildId: 'g2' }), guildOpts), false);
});

test('a denied channel is ignored even inside an allowed server', () => {
  const opts2 = { ...guildOpts, deniedChannels: ['mods'] };
  assert.equal(shouldObserve(view({ channelId: 'mods', guildId: 'g1' }), opts2), false);
  assert.equal(shouldObserve(view({ channelId: 'general', guildId: 'g1' }), opts2), true);
});

test('the channel allowlist still works on its own, unchanged', () => {
  const opts2 = { botId: 'bot', allowedChannels: ['chan'], allowedGuilds: [], deniedChannels: [] };
  assert.equal(shouldObserve(view({ channelId: 'chan', guildId: 'g9' }), opts2), true);
  assert.equal(shouldObserve(view({ channelId: 'other', guildId: 'g9' }), opts2), false);
});

// An explicitly named channel is a deliberate act; a server allowlist is a
// broad one. The narrow statement wins, so a channel can be opted in without
// opening its whole server.
test('an explicitly allowed channel is observed even outside an allowed server', () => {
  const opts2 = { botId: 'bot', allowedChannels: ['chan'], allowedGuilds: ['g1'], deniedChannels: [] };
  assert.equal(shouldObserve(view({ channelId: 'chan', guildId: 'elsewhere' }), opts2), true);
});

// A direct message has no guild. It must not fall through the server check.
test('a message with no server is never observed by the server rule', () => {
  assert.equal(shouldObserve(view({ channelId: 'dm', guildId: null }), guildOpts), false);
});

test('Lu still never observes himself, whatever the server rules say', () => {
  assert.equal(
    shouldObserve(view({ channelId: 'x', guildId: 'g1', author: { id: 'bot', bot: true, displayName: 'Lu' } }), guildOpts),
    false,
  );
});

test('the entry carries the server id', () => {
  assert.equal(toEntry(view({ guildId: 'g1' }), { botId: 'bot' }).guildId, 'g1');
});

test('observes a human message in an allowed channel, mention or not', () => {
  assert.equal(shouldObserve(view(), opts), true);
});

test('observes other bots, so their messages reach history', () => {
  assert.equal(shouldObserve(view({ author: { id: 'b2', bot: true, displayName: 'b2' } }), opts), true);
});

test('drops its own messages', () => {
  assert.equal(shouldObserve(view({ author: { id: 'bot', bot: true, displayName: 'Lu' } }), opts), false);
});

test('drops channels not on the allowlist, and an empty allowlist permits none', () => {
  assert.equal(shouldObserve(view({ channelId: 'other' }), opts), false);
  assert.equal(shouldObserve(view(), { ...opts, allowedChannels: [] }), false);
});

test('toEntry maps the view to an entry', () => {
  assert.deepEqual(toEntry(view({ repliedUserId: 'ana' }), { botId: 'bot' }), {
    messageId: 'm1', channelId: 'chan', authorId: 'human', name: 'sam',
    isBot: false, isLu: false, mentionsLu: false, mentionsOthers: false,
    repliesToLu: false, repliesToOther: true, at: 1000, text: 'hello',
    authorCanManageNicknames: false, inGuild: false,
    mentions: [], luId: 'bot', guildId: 'g1',
  });
});

// --- Task 15: nickname change permission and guild fields ------------------

test('toEntry carries authorCanManageNicknames and inGuild from the view', () => {
  const entry = toEntry(view({ authorCanManageNicknames: true, inGuild: true }), { botId: 'bot' });
  assert.equal(entry.authorCanManageNicknames, true);
  assert.equal(entry.inGuild, true);
});

test('toEntry defaults authorCanManageNicknames and inGuild to false when absent from the view', () => {
  const entry = toEntry(view(), { botId: 'bot' });
  assert.equal(entry.authorCanManageNicknames, false);
  assert.equal(entry.inGuild, false);
});

// Open bug in .agents/STATUS.md: stripping the mention tag left a bare "@Lu"
// message empty, and the model server rejects empty content with HTTP 400.
test('a bare mention of Lu becomes "@Lu", never empty text', () => {
  const entry = toEntry(view({ content: '<@bot>', mentionedUsers: [{ id: 'bot', displayName: 'Lu Bot' }] }), { botId: 'bot' });
  assert.equal(entry.text, `@${LU_NAME}`);
  assert.equal(entry.mentionsLu, true);
});

test('other user mentions become @displayName; unknown ones @someone', () => {
  const entry = toEntry(view({
    content: 'ask <@!ana> or <@999> in <#123>',
    mentionedUsers: [{ id: 'ana', displayName: 'ana' }],
  }), { botId: 'bot' });
  assert.equal(entry.text, 'ask @ana or @someone in <#123>');
  assert.equal(entry.mentionsOthers, true);
  assert.equal(entry.mentionsLu, false);
});

test('a reply to Lu is flagged as such', () => {
  const entry = toEntry(view({ repliedUserId: 'bot' }), { botId: 'bot' });
  assert.equal(entry.repliesToLu, true);
  assert.equal(entry.repliesToOther, false);
});

test('Lu posts as a plain channel message that pings nobody, never as a reply', async () => {
  const calls = [];
  const channel = {
    async send(payload) { calls.push(['send', payload]); return { id: 'new1' }; },
    async reply() { calls.push(['reply']); },
    sendTyping: async () => {},
  };
  const id = await createChannelIo(channel).send('wot');
  assert.equal(id, 'new1');
  assert.deepEqual(calls, [['send', { content: 'wot', allowedMentions: { parse: [] } }]]);
});

test('createChannelIo.applyNickname sets the nickname and reports ok', async () => {
  const calls = [];
  const channel = {
    guild: { members: { me: { async setNickname(name) { calls.push(name); } } } },
  };
  const out = await createChannelIo(channel).applyNickname('Bob');
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(calls, ['Bob']);
});

test('createChannelIo.applyNickname(null) clears the nickname', async () => {
  const calls = [];
  const channel = {
    guild: { members: { me: { async setNickname(name) { calls.push(name); } } } },
  };
  const out = await createChannelIo(channel).applyNickname(null);
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(calls, [null]);
});

test('createChannelIo.applyNickname reports refused when Discord rejects the change', async () => {
  const channel = {
    guild: { members: { me: { async setNickname() { throw new Error('Missing Permissions'); } } } },
  };
  const out = await createChannelIo(channel).applyNickname('Bob');
  assert.deepEqual(out, { ok: false, reason: 'refused' });
});

test('createChannelIo.applyNickname reports notInGuild when the channel has no guild', async () => {
  const out = await createChannelIo({}).applyNickname('Bob');
  assert.deepEqual(out, { ok: false, reason: 'notInGuild' });
});

function guildWith(members, { search } = {}) {
  return {
    guild: {
      members: {
        async fetch(id) {
          if (!members[id]) throw new Error('Unknown Member');
          return members[id];
        },
        search: search ?? (async () => new Map()),
      },
    },
  };
}

test('createChannelIo.renameMember sets that member\'s nickname', async () => {
  const calls = [];
  const channel = guildWith({ sam: { manageable: true, async setNickname(n) { calls.push(n); } } });
  assert.deepEqual(await createChannelIo(channel).renameMember('sam', 'potato'), { ok: true });
  assert.deepEqual(await createChannelIo(channel).renameMember('sam', null), { ok: true });
  assert.deepEqual(calls, ['potato', null]);
});

test('createChannelIo.renameMember will not try on someone who outranks Lu', async () => {
  const calls = [];
  const channel = guildWith({ boss: { manageable: false, async setNickname(n) { calls.push(n); } } });
  assert.deepEqual(await createChannelIo(channel).renameMember('boss', 'x'), { ok: false, reason: 'outranked' });
  assert.deepEqual(calls, []);
});

test('createChannelIo.renameMember reports refused when Discord rejects it or the member is gone', async () => {
  const channel = guildWith({ sam: { manageable: true, async setNickname() { throw new Error('Missing Permissions'); } } });
  assert.deepEqual(await createChannelIo(channel).renameMember('sam', 'x'), { ok: false, reason: 'refused' });
  assert.deepEqual(await createChannelIo(channel).renameMember('nobody', 'x'), { ok: false, reason: 'refused' });
});

test('createChannelIo.renameMember reports notInGuild outside a server', async () => {
  assert.deepEqual(await createChannelIo({}).renameMember('sam', 'x'), { ok: false, reason: 'notInGuild' });
});

test('createChannelIo.findMembers keeps only exact name matches from the search', async () => {
  const queries = [];
  const found = new Map([
    ['d1', { id: 'd1', displayName: 'dave', nickname: null, user: { username: 'dave_x', globalName: null } }],
    ['d2', { id: 'd2', displayName: 'davey', nickname: null, user: { username: 'davey', globalName: 'Davey' } }],
    ['d3', { id: 'd3', displayName: 'Rave', nickname: 'Rave', user: { username: 'r', globalName: 'Dave' } }],
  ]);
  const channel = guildWith({}, { search: async (opts) => { queries.push(opts); return found; } });
  assert.deepEqual(await createChannelIo(channel).findMembers('Dave'), [
    { id: 'd1', name: 'dave' }, { id: 'd3', name: 'Rave' },
  ]);
  assert.equal(queries[0].query, 'Dave');
});

test('createChannelIo.findMembers finds nobody outside a server', async () => {
  assert.deepEqual(await createChannelIo({}).findMembers('dave'), []);
});

// --- Whole-branch review, finding F: Discord's 2000-character reply limit ---
//
// message.reply() throws DiscordAPIError[50035] over 2000 characters. That
// throw is swallowed by the adapter's catch and the user gets silence, which
// looks exactly like the bot having nothing to say.

test('F: a short reply is returned untouched', () => {
  assert.equal(truncateForDiscord('Short and to the point.'), 'Short and to the point.');
});

test('F: a reply at the limit is returned untouched', () => {
  const text = 'a'.repeat(DISCORD_REPLY_LIMIT);
  assert.equal(truncateForDiscord(text), text);
});

test('F: an overlong reply is cut to the limit with an ellipsis', () => {
  const out = truncateForDiscord('a'.repeat(DISCORD_REPLY_LIMIT + 500));
  assert.ok(out.length <= DISCORD_REPLY_LIMIT, `expected <= limit, got ${out.length}`);
  assert.ok(out.endsWith('…'));
});

test('F: truncation prefers the last sentence boundary before the limit', () => {
  const out = truncateForDiscord(`Sentence one here. Sentence two.${'x'.repeat(500)}`, 30);
  assert.ok(out.length <= 30);
  assert.equal(out, 'Sentence one here.…');
});

test('F: truncation prefers a newline boundary over a mid-word cut', () => {
  const out = truncateForDiscord(`First line is here.\n${'x'.repeat(500)}`, 30);
  assert.equal(out, 'First line is here.…');
});

test('F: a limit with no usable boundary still cuts hard rather than throwing', () => {
  const out = truncateForDiscord('x'.repeat(500), 20);
  assert.equal(out.length, 20);
  assert.ok(out.endsWith('…'));
});

// --- Typing indicator ---
//
// A reply takes 13-15s on the deployment host, and ~25s on the first message
// after a restart. Discord's indicator expires after ~10s, so it is refreshed
// on a timer rather than sent once.

function stubChannel() {
  const calls = [];
  return { calls, sendTyping: async () => { calls.push(Date.now()); } };
}

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setIntervalImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearIntervalImpl: (id) => { timers.delete(id); },
    tick: () => { for (const { fn } of timers.values()) fn(); },
    active: () => timers.size,
  };
}

test('typing is sent immediately, before any timer fires', async () => {
  const channel = stubChannel();
  const t = fakeTimers();
  startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  await new Promise((r) => setImmediate(r));

  assert.equal(channel.calls.length, 1);
});

test('typing refreshes on each interval so it outlives Discord expiry', async () => {
  const channel = stubChannel();
  const t = fakeTimers();
  startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  await new Promise((r) => setImmediate(r));
  t.tick();
  t.tick();
  await new Promise((r) => setImmediate(r));

  assert.equal(channel.calls.length, 3);
});

test('the refresh interval is inside Discord ten-second expiry', () => {
  assert.ok(TYPING_REFRESH_MS < 10000, `${TYPING_REFRESH_MS} would let the indicator lapse`);
});

test('stop clears the timer so Lu does not type forever', async () => {
  const channel = stubChannel();
  const t = fakeTimers();
  const handle = startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  handle.stop();

  assert.equal(t.active(), 0);
});

test('a failing sendTyping does not reject into the caller', async () => {
  const calls = [];
  const channel = { sendTyping: async () => { calls.push(Date.now()); throw new Error('discord down'); } };
  const t = fakeTimers();

  // A cosmetic indicator must never be able to take down a reply, but the
  // send must still have been attempted, and stop() must still clear the
  // timer afterwards — a broken sendTyping must not silently disable either.
  const handle = startTyping({ channel, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);

  handle.stop();
  assert.equal(t.active(), 0);
});

// --- Mentioned users on the entry ---
// toEntry renders mention tags to "@DisplayName" so a bare "@Lu" message is
// never empty (the model server rejects empty content with a 400). That
// rendering destroys the IDs, which "lu credits @someone" needs to know who
// was meant. Both are carried: the rendered text for the model, the ids for
// code.

test('mentioned users are carried on the entry with their ids', () => {
  const entry = toEntry(view({
    content: 'lu credits <@42>',
    mentionedUsers: [{ id: '42', displayName: 'Bob' }],
  }), { botId: 'bot' });
  assert.deepEqual(entry.mentions, [{ id: '42', name: 'Bob' }]);
  assert.equal(entry.text, 'lu credits @Bob');
});

test('a message mentioning nobody carries an empty list', () => {
  assert.deepEqual(toEntry(view({ content: 'hello' }), { botId: 'bot' }).mentions, []);
});

test('Lu is listed among the mentions like anyone else', () => {
  const entry = toEntry(view({
    content: '<@bot> hello',
    mentionedUsers: [{ id: 'bot', displayName: 'Lu' }],
  }), { botId: 'bot' });
  assert.deepEqual(entry.mentions, [{ id: 'bot', name: 'Lu' }]);
});

// Every test above uses a single-element mentionedUsers array, so an
// implementation that reversed the array, sorted it, or filtered Lu out
// would still pass all of them. This pins both properties at once with a
// three-entry array, Lu in the middle, asserted with one deepEqual over the
// whole list.
test('mentions preserve Discord order and keep Lu in the middle', () => {
  const entry = toEntry(view({
    content: '<@1> <@bot> <@2> hello',
    mentionedUsers: [
      { id: '1', displayName: 'Alice' },
      { id: 'bot', displayName: 'Lu' },
      { id: '2', displayName: 'Carl' },
    ],
  }), { botId: 'bot' });
  assert.deepEqual(entry.mentions, [
    { id: '1', name: 'Alice' },
    { id: 'bot', name: 'Lu' },
    { id: '2', name: 'Carl' },
  ]);
});

// Carried so downstream code can tell which mention is Lu. The alternative
// was threading botId through createConversation, which every other consumer
// would have had to accept and ignore.
test('the entry knows Lu\'s own id', () => {
  assert.equal(toEntry(view({ content: 'hello' }), { botId: 'bot' }).luId, 'bot');
});

// --- Intents (WP-1) ---
// Discord refuses the whole login (close code 4014) when a privileged intent
// is asked for but not enabled in the Developer Portal. So Server Members is
// asked for only when a feature that needs it is switched on.

const off = { moderation: false, logging: false, welcome: false, roleMenus: false };

test('with every server feature off, only the three chat intents are asked for', () => {
  assert.deepEqual(intentsFor({ features: off }).sort((a, b) => a - b), [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
  ].sort((a, b) => a - b));
});

test('moderation, logging and welcome each need Server Members', () => {
  for (const key of ['moderation', 'logging', 'welcome']) {
    assert.ok(intentsFor({ features: { ...off, [key]: true } }).includes(GatewayIntentBits.GuildMembers), key);
  }
});

test('role menus alone do not ask for the privileged intent', () => {
  assert.ok(!intentsFor({ features: { ...off, roleMenus: true } }).includes(GatewayIntentBits.GuildMembers));
});

test('moderation and logging need the moderation intent; welcome does not', () => {
  assert.ok(intentsFor({ features: { ...off, moderation: true } }).includes(GatewayIntentBits.GuildModeration));
  assert.ok(intentsFor({ features: { ...off, logging: true } }).includes(GatewayIntentBits.GuildModeration));
  assert.ok(!intentsFor({ features: { ...off, welcome: true } }).includes(GatewayIntentBits.GuildModeration));
});

test('a config with no features block asks for the chat intents only', () => {
  assert.equal(intentsFor({}).length, 3);
});

// --- Partials (final review F1) ---
// Without Partials.Message / Partials.GuildMember, discord.js only synthesises
// a partial for an uncached message/member -- MessageDelete, MessageUpdate and
// GuildMemberRemove never fire for them. WP-2/WP-3 need those events, but only
// when a feature that consumes them is on, so the default (every switch off)
// stays exactly as it was before this task.

test('with every server feature off, no partials are requested', () => {
  assert.deepEqual(partialsFor({ features: off }), []);
});

test('moderation, logging and welcome each need the message and member partials', () => {
  for (const key of ['moderation', 'logging', 'welcome']) {
    const result = partialsFor({ features: { ...off, [key]: true } });
    assert.ok(result.includes(Partials.Message), key);
    assert.ok(result.includes(Partials.GuildMember), key);
  }
});

test('role menus alone do not request partials', () => {
  assert.deepEqual(partialsFor({ features: { ...off, roleMenus: true } }), []);
});

test('a config with no features block requests no partials', () => {
  assert.deepEqual(partialsFor({}), []);
});

// --- Interaction adapter (WP-1) ---

const fakeInteraction = (over = {}) => ({
  commandName: 'ban', guildId: 'g1', channelId: 'c1',
  user: { id: 'u1', username: 'sam', displayName: 'Sam' },
  member: { displayName: 'Sammy' },
  memberPermissions: { toArray: () => ['BanMembers', 'SendMessages'] },
  options: {
    data: [
      { name: 'target', type: ApplicationCommandOptionType.User, value: 'u2', user: { id: 'u2', displayName: 'Bo' }, member: { displayName: 'Bobby' } },
      { name: 'reason', type: ApplicationCommandOptionType.String, value: 'spam' },
      { name: 'where', type: ApplicationCommandOptionType.Channel, value: 'c9', channel: { id: 'c9', name: 'logs' } },
    ],
  },
  replied: false, deferred: false,
  ...over,
});

test('an interaction becomes a plain view', () => {
  const v = interactionView(fakeInteraction());
  assert.equal(v.commandName, 'ban');
  assert.equal(v.guildId, 'g1');
  assert.deepEqual(v.user, { id: 'u1', name: 'Sammy' });
  assert.deepEqual(v.memberPermissions, ['BanMembers', 'SendMessages']);
  assert.deepEqual(v.options.target, { id: 'u2', name: 'Bobby' });
  assert.equal(v.options.reason, 'spam');
  assert.deepEqual(v.options.where, { id: 'c9', name: 'logs' });
});

test('an interaction outside a server has no guild and no permissions', () => {
  const v = interactionView(fakeInteraction({ guildId: null, member: null, memberPermissions: null }));
  assert.equal(v.guildId, null);
  assert.deepEqual(v.memberPermissions, []);
  assert.deepEqual(v.user, { id: 'u1', name: 'Sam' });
});

test('replies are private by default and can never ping', async () => {
  const calls = [];
  const it = fakeInteraction({ reply: async (o) => { calls.push(['reply', o]); } });
  await createInteractionIo(it).reply({ content: 'hi @everyone' });
  assert.equal(calls[0][0], 'reply');
  assert.equal(calls[0][1].flags, MessageFlags.Ephemeral);
  assert.deepEqual(calls[0][1].allowedMentions, { parse: [] });
});

test('a public reply has no ephemeral flag', async () => {
  const calls = [];
  const it = fakeInteraction({ reply: async (o) => { calls.push(o); } });
  await createInteractionIo(it).reply({ content: 'x' }, { ephemeral: false });
  assert.equal(calls[0].flags, undefined);
});

test('a second reply becomes a follow-up', async () => {
  const calls = [];
  const it = fakeInteraction({ replied: true, followUp: async (o) => { calls.push(['followUp', o]); } });
  await createInteractionIo(it).reply({ content: 'x' });
  assert.equal(calls[0][0], 'followUp');
});

// --- Message store feed (WP-1) ---

const fakeMessage = (over = {}) => ({
  id: 'm1', guildId: 'g1', channelId: 'c1', content: 'hello', createdTimestamp: 5, system: false,
  author: { id: 'u1', bot: false, displayName: 'Sam' },
  member: { displayName: 'Sammy' },
  attachments: new Map([['a1', { name: 'cat.png' }]]),
  ...over,
});

test('a guild message becomes a store record', () => {
  assert.deepEqual(messageRecordOf(fakeMessage()), {
    id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'Sammy',
    text: 'hello', attachments: ['cat.png'], at: 5, authorRoleIds: [],
  });
});

test('bots, direct messages and system messages are not stored', () => {
  assert.equal(messageRecordOf(fakeMessage({ author: { id: 'b', bot: true, displayName: 'B' } })), null);
  assert.equal(messageRecordOf(fakeMessage({ guildId: null })), null);
  assert.equal(messageRecordOf(fakeMessage({ system: true })), null);
});

// --- MessageUpdate handler ordering (final review F2) ---
// The store must not be updated with the new text until any edit-log handler
// has already emitted with the old text -- otherwise a future edit-log
// listener calling messageStore.get(id) sees the NEW text.

function fakeGuildEvents({ hasIt = true, onEmit = null } = {}) {
  const calls = [];
  return {
    has: () => hasIt,
    async emit(name, guildId, payload) {
      calls.push({ name, guildId, payload });
      if (onEmit) await onEmit(payload);
    },
    calls,
  };
}

test('the store still has the old text while the emitted handler runs, and the new text after', async () => {
  const messageStore = createMessageStore();
  messageStore.record({
    id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'A',
    text: 'old', attachments: [], at: Date.now(),
  });
  let seenDuringEmit = null;
  const guildEvents = fakeGuildEvents({
    onEmit: async () => {
      seenDuringEmit = messageStore.get('m1').text;
    },
  });
  const handler = createMessageUpdateHandler({ messageStore, guildEvents });
  const before = { id: 'm1', guildId: 'g1', content: 'old' };
  const after = { id: 'm1', guildId: 'g1', content: 'new' };
  await handler(before, after);

  assert.equal(seenDuringEmit, 'old');
  assert.equal(messageStore.get('m1').text, 'new');
});

test('the emit carries [before, after] and the guild id of after', async () => {
  const messageStore = createMessageStore();
  messageStore.record({
    id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'A',
    text: 'old', attachments: [], at: Date.now(),
  });
  const guildEvents = fakeGuildEvents();
  const handler = createMessageUpdateHandler({ messageStore, guildEvents });
  const before = { id: 'm1', guildId: 'g1', content: 'old' };
  const after = { id: 'm1', guildId: 'g1', content: 'new' };
  await handler(before, after);

  assert.equal(guildEvents.calls.length, 1);
  assert.equal(guildEvents.calls[0].name, 'messageUpdate');
  assert.equal(guildEvents.calls[0].guildId, 'g1');
  assert.deepEqual(guildEvents.calls[0].payload, [before, after]);
});

test('with guildEvents null, the store still updates', async () => {
  const messageStore = createMessageStore();
  messageStore.record({
    id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'A',
    text: 'old', attachments: [], at: Date.now(),
  });
  const handler = createMessageUpdateHandler({ messageStore, guildEvents: null });
  await handler({ id: 'm1', content: 'old' }, { id: 'm1', guildId: 'g1', content: 'new' });
  assert.equal(messageStore.get('m1').text, 'new');
});

test('with messageStore null, the emit still happens', async () => {
  const guildEvents = fakeGuildEvents();
  const handler = createMessageUpdateHandler({ messageStore: null, guildEvents });
  await handler({ id: 'm1', content: 'old' }, { id: 'm1', guildId: 'g1', content: 'new' });
  assert.equal(guildEvents.calls.length, 1);
});

test('with guildEvents.has() false, no emit happens but the store still updates', async () => {
  const messageStore = createMessageStore();
  messageStore.record({
    id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'A',
    text: 'old', attachments: [], at: Date.now(),
  });
  const guildEvents = fakeGuildEvents({ hasIt: false });
  const handler = createMessageUpdateHandler({ messageStore, guildEvents });
  await handler({ id: 'm1', content: 'old' }, { id: 'm1', guildId: 'g1', content: 'new' });
  assert.equal(guildEvents.calls.length, 0);
  assert.equal(messageStore.get('m1').text, 'new');
});

test('a throwing guild handler does not prevent the store update', async () => {
  const messageStore = createMessageStore();
  messageStore.record({
    id: 'm1', guildId: 'g1', channelId: 'c1', authorId: 'u1', authorName: 'A',
    text: 'old', attachments: [], at: Date.now(),
  });
  const guildEvents = { has: () => true, emit: async () => { throw new Error('boom'); } };
  const error = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const handler = createMessageUpdateHandler({ messageStore, guildEvents });
    await handler({ id: 'm1', content: 'old' }, { id: 'm1', guildId: 'g1', content: 'new' });
  } finally {
    console.error = error;
  }
  assert.equal(messageStore.get('m1').text, 'new');
  assert.ok(errors.length > 0);
});

// --- Command registration (WP-1) ---

test('commands are registered per guild, and one failure does not stop the rest', async () => {
  const set = [];
  const client = { guilds: { fetch: async (id) => {
    if (id === 'bad') throw new Error('Missing Access');
    return { commands: { set: async (defs) => { set.push([id, defs.length]); } } };
  } } };
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    await registerGuildCommands({ client, guildIds: ['bad', 'g1'], definitions: [{ name: 'x' }] });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(set, [['g1', 1]]);
  assert.match(warned.join('\n'), /bad.*Missing Access/);
});

// --- Member cache warming (final review I1) ---

test('warmMemberCaches fetches each guild\'s members and logs the count', async () => {
  const fetched = [];
  const client = { guilds: { fetch: async (id) => ({
    members: { fetch: async () => { fetched.push(id); return { size: 3 }; } },
  }) } };
  const log = console.log;
  const logged = [];
  console.log = (m) => logged.push(m);
  try {
    await warmMemberCaches({ client, guildIds: ['g1', 'g2'] });
  } finally {
    console.log = log;
  }
  assert.deepEqual(fetched, ['g1', 'g2']);
  assert.match(logged.join('\n'), /Loaded 3 members in guild g1\./);
  assert.match(logged.join('\n'), /Loaded 3 members in guild g2\./);
});

test('warmMemberCaches warns about one failing guild and still loads the next', async () => {
  const fetched = [];
  const client = { guilds: { fetch: async (id) => {
    if (id === 'bad') throw new Error('Missing Access');
    return { members: { fetch: async () => { fetched.push(id); return { size: 5 }; } } };
  } } };
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    await warmMemberCaches({ client, guildIds: ['bad', 'g1'] });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(fetched, ['g1']);
  assert.match(warned.join('\n'), /Could not load members in guild bad: Missing Access/);
});

test('warmMemberCaches never throws', async () => {
  const client = { guilds: { fetch: async () => { throw new Error('boom'); } } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.doesNotReject(warmMemberCaches({ client, guildIds: ['g1'] }));
  } finally {
    console.warn = warn;
  }
});

// --- WP-3 adapter groundwork ---

test('a store record carries the author role ids, without @everyone', () => {
  const member = { displayName: 'Sammy', roles: { cache: new Map([['g1', {}], ['r1', {}], ['r2', {}]]) } };
  assert.deepEqual(messageRecordOf(fakeMessage({ member })).authorRoleIds, ['r1', 'r2']);
});

test('a sub-command becomes view.subcommand, with its own options', () => {
  const v = interactionView(fakeInteraction({
    commandName: 'log',
    options: { data: [{
      name: 'channel', type: ApplicationCommandOptionType.Subcommand,
      options: [
        { name: 'category', type: ApplicationCommandOptionType.String, value: 'messages' },
        { name: 'channel', type: ApplicationCommandOptionType.Channel, value: 'c9', channel: { id: 'c9', name: 'logs' } },
      ],
    }] },
  }));
  assert.equal(v.subcommand, 'channel');
  assert.equal(v.options.category, 'messages');
  assert.deepEqual(v.options.channel, { id: 'c9', name: 'logs' });
});

test('a command without sub-commands has subcommand null', () => {
  assert.equal(interactionView(fakeInteraction()).subcommand, null);
});

test('sendToChannel posts with pings disabled', async () => {
  const sent = [];
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => { sent.push(p); return { id: 'm' }; } }) } };
  await sendToChannel(client, 'c1', { content: 'hi @everyone' });
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.equal(sent[0].content, 'hi @everyone');
});

test('sendToChannel refuses a non-text channel with the unknown-channel code', async () => {
  const client = { channels: { fetch: async () => ({ isTextBased: () => false }) } };
  await assert.rejects(sendToChannel(client, 'c1', {}), (err) => err.code === 10003);
});

test('sendToChannel before connecting says so', async () => {
  await assert.rejects(sendToChannel(null, 'c1', {}), /Not connected/);
});

test('missingChannelPermissions reports only the names Lu lacks', async () => {
  const have = new Set(['ViewChannel', 'SendMessages']);
  const client = {
    user: { id: 'bot' },
    channels: {
      fetch: async () => ({
        permissionsFor: () => ({ has: (name) => have.has(name) }),
      }),
    },
  };
  const missing = await missingChannelPermissions(client, 'c1', ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles']);
  assert.deepEqual(missing, ['EmbedLinks', 'AttachFiles']);
});

test('missingChannelPermissions returns nothing missing when Lu has every permission', async () => {
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async () => ({ permissionsFor: () => ({ has: () => true }) }) },
  };
  assert.deepEqual(await missingChannelPermissions(client, 'c1', ['ViewChannel', 'SendMessages']), []);
});

test('missingChannelPermissions treats a null permissionsFor as missing everything', async () => {
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async () => ({ permissionsFor: () => null }) },
  };
  assert.deepEqual(await missingChannelPermissions(client, 'c1', ['ViewChannel', 'AttachFiles']), ['ViewChannel', 'AttachFiles']);
});

test('missingChannelPermissions throws, keeping the code, when the fetch fails', async () => {
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async () => { throw Object.assign(new Error('Missing Access'), { code: 50001 }); } },
  };
  await assert.rejects(missingChannelPermissions(client, 'c1', ['ViewChannel']), (err) => err.code === 50001);
});
