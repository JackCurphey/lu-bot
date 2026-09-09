import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadLlmConfig } from '../src/config.js';

const valid = {
  DISCORD_BOT_TOKEN: 'tok',
  DISCORD_GUILD_ID: 'guild',
  DISCORD_ALLOWED_CHANNELS: '111, 222',
  LLM_CHAT_MODEL: 'chat',
  LLM_JUDGE_MODEL: 'judge',
  LLM_EMBED_MODEL: 'embed',
};

test('parses a valid environment', () => {
  const cfg = loadConfig(valid);
  assert.equal(cfg.discord.token, 'tok');
  assert.deepEqual(cfg.discord.allowedChannels, ['111', '222']);
  assert.equal(cfg.llm.baseUrl, 'http://localhost:1234/v1');
  assert.equal(cfg.trigger.similarityFloor, 0.65);
  assert.equal(cfg.trigger.enabled, true);
});

test('lists every missing required key at once', () => {
  assert.throws(
    () => loadConfig({ DISCORD_BOT_TOKEN: 'tok' }),
    (err) => err.message.includes('DISCORD_GUILD_ID') && err.message.includes('LLM_CHAT_MODEL'),
  );
});

test('an empty channel allowlist parses to an empty array', () => {
  const cfg = loadConfig({ ...valid, DISCORD_ALLOWED_CHANNELS: '' });
  assert.deepEqual(cfg.discord.allowedChannels, []);
});

test('loadLlmConfig returns the correct shape with a default baseUrl', () => {
  const llm = loadLlmConfig({
    LLM_CHAT_MODEL: 'chat',
    LLM_JUDGE_MODEL: 'judge',
    LLM_EMBED_MODEL: 'embed',
  });
  assert.deepEqual(llm, {
    baseUrl: 'http://localhost:1234/v1',
    chatModel: 'chat',
    judgeModel: 'judge',
    embedModel: 'embed',
  });
});

test('loadLlmConfig does not require Discord credentials', () => {
  assert.doesNotThrow(() =>
    loadLlmConfig({
      LLM_CHAT_MODEL: 'chat',
      LLM_JUDGE_MODEL: 'judge',
      LLM_EMBED_MODEL: 'embed',
    }),
  );
});

test('loadLlmConfig lists every missing model key at once', () => {
  assert.throws(
    () => loadLlmConfig({}),
    (err) =>
      err.message.includes('LLM_CHAT_MODEL') &&
      err.message.includes('LLM_JUDGE_MODEL') &&
      err.message.includes('LLM_EMBED_MODEL'),
  );
});

test('loadLlmConfig honours an explicit LLM_BASE_URL override', () => {
  const llm = loadLlmConfig({
    LLM_CHAT_MODEL: 'chat',
    LLM_JUDGE_MODEL: 'judge',
    LLM_EMBED_MODEL: 'embed',
    LLM_BASE_URL: 'http://example.test/v1',
  });
  assert.equal(llm.baseUrl, 'http://example.test/v1');
});

test('loadConfig still returns exactly the same llm section as before', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.llm, {
    baseUrl: 'http://localhost:1234/v1',
    chatModel: 'chat',
    judgeModel: 'judge',
    embedModel: 'embed',
  });
});
