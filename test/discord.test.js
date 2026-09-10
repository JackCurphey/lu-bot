import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandle, truncateForDiscord, DISCORD_REPLY_LIMIT, startTyping, TYPING_REFRESH_MS } from '../src/discord.js';

const opts = { botId: 'bot', allowedChannels: ['chan'] };
const base = { authorId: 'human', authorIsBot: false, channelId: 'chan', mentionsBot: true };

test('handles a mention from a human in an allowed channel', () => {
  assert.equal(shouldHandle(base, opts), true);
});

test('ignores its own messages', () => {
  assert.equal(shouldHandle({ ...base, authorId: 'bot' }, opts), false);
});

test('ignores other bots', () => {
  assert.equal(shouldHandle({ ...base, authorIsBot: true }, opts), false);
});

test('ignores channels not on the allowlist', () => {
  assert.equal(shouldHandle({ ...base, channelId: 'other' }, opts), false);
});

test('ignores messages that do not mention it', () => {
  assert.equal(shouldHandle({ ...base, mentionsBot: false }, opts), false);
});

test('an empty allowlist permits no channels', () => {
  assert.equal(shouldHandle(base, { ...opts, allowedChannels: [] }), false);
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
