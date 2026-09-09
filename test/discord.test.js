import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandle } from '../src/discord.js';

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
