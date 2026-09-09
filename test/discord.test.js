import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandle, truncateForDiscord, DISCORD_REPLY_LIMIT } from '../src/discord.js';

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
