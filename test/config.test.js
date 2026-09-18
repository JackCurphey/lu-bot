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
  assert.deepEqual(cfg.reply, { timeoutSeconds: 90, maxTokens: 120 });
});

test('REPLY_MAX_TOKENS overrides the default', () => {
  const cfg = loadConfig({ ...valid, REPLY_MAX_TOKENS: '200' });
  assert.equal(cfg.reply.maxTokens, 200);
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

// --- Task 15: nickname config --------------------------------------------

test('nickname defaults: enabled and requirePermission both true', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.nickname, { enabled: true, requirePermission: true });
});

test('NICKNAME_ENABLED=false disables the feature', () => {
  const cfg = loadConfig({ ...valid, NICKNAME_ENABLED: 'false' });
  assert.equal(cfg.nickname.enabled, false);
});

test('NICKNAME_REQUIRE_PERMISSION=false lets anyone ask', () => {
  const cfg = loadConfig({ ...valid, NICKNAME_REQUIRE_PERMISSION: 'false' });
  assert.equal(cfg.nickname.requirePermission, false);
});

test('a random reply chance outside 0..1 is rejected', () => {
  assert.throws(
    () => loadConfig({ ...valid, RANDOM_REPLY_CHANCE: '2' }),
    (err) => err.message.includes('RANDOM_REPLY_CHANCE'),
  );
});

// --- Imperial Credits config ---
// Booleans follow the codebase's default-on idiom: only the literal string
// 'false' turns one off. Ranges throw at startup with the offending value,
// because a min above a max is a configuration error and should not wait to
// become a runtime surprise.

test('credits config defaults', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.credits, {
    enabled: true,
    min: 15,
    max: 25,
    cooldownSeconds: 30,
    minChars: 3,
    announceLevelUp: true,
    flushMs: 2000,
    mentionChance: 0.15,
  });
});

test('credits can be turned off', () => {
  assert.equal(loadConfig({ ...valid, CREDITS_ENABLED: 'false' }).credits.enabled, false);
});

test('level-up announcements can be turned off', () => {
  assert.equal(
    loadConfig({ ...valid, CREDITS_ANNOUNCE_LEVEL_UP: 'false' }).credits.announceLevelUp,
    false,
  );
});

test('credits award range is configurable', () => {
  const cfg = loadConfig({ ...valid, CREDITS_MIN: '5', CREDITS_MAX: '9' });
  assert.equal(cfg.credits.min, 5);
  assert.equal(cfg.credits.max, 9);
});

test('cooldown, minimum length and flush interval are configurable', () => {
  const cfg = loadConfig({
    ...valid,
    CREDITS_COOLDOWN_SECONDS: '60',
    CREDITS_MIN_CHARS: '1',
    CREDITS_FLUSH_MS: '500',
  });
  assert.equal(cfg.credits.cooldownSeconds, 60);
  assert.equal(cfg.credits.minChars, 1);
  assert.equal(cfg.credits.flushMs, 500);
});

test('a minimum above the maximum is rejected with both values', () => {
  assert.throws(
    () => loadConfig({ ...valid, CREDITS_MIN: '30', CREDITS_MAX: '20' }),
    /CREDITS_MIN.*30.*20|CREDITS_MIN.*20.*30/s,
  );
});

test('a negative minimum award is rejected', () => {
  assert.throws(() => loadConfig({ ...valid, CREDITS_MIN: '-1' }), /CREDITS_MIN/);
});

test('a negative minimum message length is rejected', () => {
  assert.throws(() => loadConfig({ ...valid, CREDITS_MIN_CHARS: '-1' }), /CREDITS_MIN_CHARS/);
});

test('a negative flush interval is rejected', () => {
  assert.throws(() => loadConfig({ ...valid, CREDITS_FLUSH_MS: '-1' }), /CREDITS_FLUSH_MS/);
});

test('a negative cooldown is rejected', () => {
  assert.throws(() => loadConfig({ ...valid, CREDITS_COOLDOWN_SECONDS: '-1' }), /CREDITS_COOLDOWN_SECONDS/);
});

// --- Server allowlist ---
// A channel allowlist goes stale the moment someone creates a channel, so a
// server rule was added alongside it. The two union; the denylist only ever
// narrows the server rule, never the explicit channel list.

test('server allowlist and channel denylist parse as id lists', () => {
  const cfg = loadConfig({ ...valid, DISCORD_ALLOWED_GUILDS: ' g1 , g2 ', DISCORD_DENIED_CHANNELS: 'mods' });
  assert.deepEqual(cfg.discord.allowedGuilds, ['g1', 'g2']);
  assert.deepEqual(cfg.discord.deniedChannels, ['mods']);
});

test('both lists default to empty', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.discord.allowedGuilds, []);
  assert.deepEqual(cfg.discord.deniedChannels, []);
});

test('a server allowlist alone is enough to silence the nothing-configured warning', () => {
  const cfg = loadConfig({ ...valid, DISCORD_ALLOWED_CHANNELS: '', DISCORD_ALLOWED_GUILDS: 'g1' });
  assert.deepEqual(startupWarnings(cfg), []);
});

test('warns when neither channels nor servers are configured', () => {
  const cfg = loadConfig({ ...valid, DISCORD_ALLOWED_CHANNELS: '' });
  assert.equal(startupWarnings(cfg).length, 1);
  assert.match(startupWarnings(cfg)[0], /DISCORD_ALLOWED_GUILDS/);
});

// A denylist with no server rule to narrow excludes nothing, which looks like
// it is working and is not.
test('warns when a denylist is set with no server allowlist', () => {
  const cfg = loadConfig({ ...valid, DISCORD_DENIED_CHANNELS: 'mods' });
  assert.ok(startupWarnings(cfg).some((w) => /excludes nothing/.test(w)));
});

// --- Mischief modes ------------------------------------------------------------

test('the mode weights default to the starting mix', () => {
  const cfg = loadConfig(valid);
  assert.equal(cfg.mood.enabled, true);
  assert.deepEqual(cfg.mood.weights, { gossip: 35, needler: 30, narrator: 20, windup: 15 });
});

test('each mode weight can be set on its own', () => {
  const cfg = loadConfig({ ...valid, MOOD_WEIGHT_WINDUP: '0', MOOD_WEIGHT_GOSSIP: '50' });
  assert.deepEqual(cfg.mood.weights, { gossip: 50, needler: 30, narrator: 20, windup: 0 });
});

test('modes can be switched off entirely', () => {
  assert.equal(loadConfig({ ...valid, MOOD_ENABLED: 'false' }).mood.enabled, false);
});

test('a negative mode weight is rejected', () => {
  assert.throws(
    () => loadConfig({ ...valid, MOOD_WEIGHT_NARRATOR: '-1' }),
    /MOOD_WEIGHT_NARRATOR must not be negative/,
  );
});

// Parses cleanly and leaves every reply in the flat pre-modes voice, with
// nothing anywhere saying why -- exactly what startupWarnings is for.
test('warns when modes are on but every weight is zero', () => {
  const cfg = loadConfig({
    ...valid,
    MOOD_WEIGHT_GOSSIP: '0', MOOD_WEIGHT_NEEDLER: '0',
    MOOD_WEIGHT_NARRATOR: '0', MOOD_WEIGHT_WINDUP: '0',
  });
  assert.ok(startupWarnings(cfg).some((w) => /MOOD_WEIGHT/.test(w)));
});

test('no zero-weight warning when modes are switched off deliberately', () => {
  const cfg = loadConfig({
    ...valid, MOOD_ENABLED: 'false',
    MOOD_WEIGHT_GOSSIP: '0', MOOD_WEIGHT_NEEDLER: '0',
    MOOD_WEIGHT_NARRATOR: '0', MOOD_WEIGHT_WINDUP: '0',
  });
  assert.deepEqual(startupWarnings(cfg).filter((w) => /MOOD_WEIGHT/.test(w)), []);
});

// startupWarnings is called with hand-built config objects elsewhere in the
// suite; a missing mood block must not throw.
test('startupWarnings tolerates a config with no mood block', () => {
  assert.deepEqual(startupWarnings({ discord: { allowedChannels: ['123'] } }), []);
});

test('the unprompted ledger chance defaults low', () => {
  assert.equal(loadConfig(valid).credits.mentionChance, 0.15);
});

test('the unprompted ledger chance can be set', () => {
  assert.equal(loadConfig({ ...valid, CREDITS_MENTION_CHANCE: '0' }).credits.mentionChance, 0);
  assert.equal(loadConfig({ ...valid, CREDITS_MENTION_CHANCE: '1' }).credits.mentionChance, 1);
});

test('an out-of-range ledger chance is rejected', () => {
  assert.throws(
    () => loadConfig({ ...valid, CREDITS_MENTION_CHANCE: '1.5' }),
    /CREDITS_MENTION_CHANCE must be between 0 and 1/,
  );
  assert.throws(
    () => loadConfig({ ...valid, CREDITS_MENTION_CHANCE: '-0.1' }),
    /CREDITS_MENTION_CHANCE must be between 0 and 1/,
  );
});

test('the update announcement channel is read, and off when unset', () => {
  assert.equal(loadConfig({ ...valid, UPDATE_CHANNEL_ID: ' 1538590653611515954 ' }).discord.updateChannelId, '1538590653611515954');
  assert.equal(loadConfig(valid).discord.updateChannelId, null);
  assert.equal(loadConfig({ ...valid, UPDATE_CHANNEL_ID: '' }).discord.updateChannelId, null);
});

test('suggestions are on by default and land in data/suggestions.jsonl', () => {
  const cfg = loadConfig(valid);
  assert.equal(cfg.suggestions.enabled, true);
  assert.equal(cfg.suggestions.file, 'data/suggestions.jsonl');
});

test('suggestions can be switched off and pointed somewhere else', () => {
  const cfg = loadConfig({
    ...valid, SUGGESTIONS_ENABLED: 'false', SUGGESTIONS_FILE: 'data/ideas.jsonl',
  });
  assert.equal(cfg.suggestions.enabled, false);
  assert.equal(cfg.suggestions.file, 'data/ideas.jsonl');
});
