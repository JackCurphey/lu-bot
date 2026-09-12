import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadLlmConfig, startupWarnings } from '../src/config.js';

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
    addresseeModel: 'judge',
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
    addresseeModel: 'judge',
  });
});

// --- Whole-branch review, finding I: silent no-op on the shipped default ----
//
// .env.example ships DISCORD_ALLOWED_CHANNELS empty. With it empty
// shouldHandle rejects every message, yet startup printed "Lu Bot is online."
// A new operator got a bot that connected, looked healthy and ignored
// everyone, with nothing anywhere saying why.

test('I: an empty channel allowlist produces a startup warning', () => {
  const warnings = startupWarnings({ discord: { allowedChannels: [] } });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /DISCORD_ALLOWED_CHANNELS/);
  assert.match(warnings[0], /respond to nothing|will not respond/i);
});

test('I: a populated channel allowlist produces no warning', () => {
  assert.deepEqual(startupWarnings({ discord: { allowedChannels: ['123'] } }), []);
});

// --- Old Lu stage 1: conversation settings -----------------------------------
//
// Defaults are the values agreed in the stage 1 spec. They are asserted one by
// one so a changed default is a visible, deliberate test change.

test('stage 1 defaults', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.history, { limit: 20, trimTo: 10 });
  assert.equal(cfg.trigger.cooldownSeconds, 60);
  assert.deepEqual(cfg.trigger.keywords, ['lu', 'ai bot']);
  assert.equal(cfg.trigger.randomReplyChance, 0.02);
  assert.equal(cfg.trigger.windowMessages, 8);
  assert.equal(cfg.trigger.windowMinutes, 5);
  assert.equal(cfg.trigger.pauseSeconds, 3);
  assert.equal(cfg.trigger.addresseeTimeoutSeconds, 30);
  assert.deepEqual(cfg.reply, { timeoutSeconds: 90 });
});

// A bounded judge prompt (see src/addressee.js) still runs ~250-300 tokens and
// can queue behind a reply on a host that runs one model job at a time, so the
// default carries headroom rather than a new floor. This is still overridable.
test('ADDRESSEE_TIMEOUT_SECONDS overrides the default', () => {
  const cfg = loadConfig({ ...valid, ADDRESSEE_TIMEOUT_SECONDS: '45' });
  assert.equal(cfg.trigger.addresseeTimeoutSeconds, 45);
});

test('the addressee model defaults to the judge model', () => {
  assert.equal(loadConfig(valid).llm.addresseeModel, 'judge');
});

test('the addressee model can be set on its own', () => {
  const cfg = loadConfig({ ...valid, LLM_ADDRESSEE_MODEL: 'qwen3:1.7b' });
  assert.equal(cfg.llm.addresseeModel, 'qwen3:1.7b');
});

test('trigger keywords are trimmed, lowercased and empty items dropped', () => {
  const cfg = loadConfig({ ...valid, TRIGGER_KEYWORDS: ' Lu , Comrade ,, ' });
  assert.deepEqual(cfg.trigger.keywords, ['lu', 'comrade']);
});

test('a trim size that is not below the history limit is rejected', () => {
  assert.throws(
    () => loadConfig({ ...valid, HISTORY_LIMIT: '20', HISTORY_TRIM_TO: '20' }),
    (err) => err.message.includes('HISTORY_TRIM_TO'),
  );
});

test('a random reply chance outside 0..1 is rejected', () => {
  assert.throws(
    () => loadConfig({ ...valid, RANDOM_REPLY_CHANCE: '2' }),
    (err) => err.message.includes('RANDOM_REPLY_CHANCE'),
  );
});
