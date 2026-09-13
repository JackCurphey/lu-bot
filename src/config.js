const REQUIRED = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'LLM_CHAT_MODEL',
  'LLM_JUDGE_MODEL',
  'LLM_EMBED_MODEL',
];

const LLM_REQUIRED = ['LLM_CHAT_MODEL', 'LLM_JUDGE_MODEL', 'LLM_EMBED_MODEL'];

function num(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`${key} must be a number, got "${raw}"`);
  return parsed;
}

function list(env, key, fallback) {
  const raw = env[key];
  const source = raw === undefined || raw === '' ? fallback : raw;
  return source.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function loadLlmConfig(env) {
  const missing = LLM_REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    baseUrl: env.LLM_BASE_URL || 'http://localhost:1234/v1',
    chatModel: env.LLM_CHAT_MODEL,
    judgeModel: env.LLM_JUDGE_MODEL,
    embedModel: env.LLM_EMBED_MODEL,
    // The "is this aimed at Lu?" judge may run on a smaller model than the
    // corpus judge; which one is decided by measurement on the mini.
    addresseeModel: env.LLM_ADDRESSEE_MODEL || env.LLM_JUDGE_MODEL,
  };
}

export function loadConfig(env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const channels = (env.DISCORD_ALLOWED_CHANNELS ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const history = {
    limit: num(env, 'HISTORY_LIMIT', 20),
    trimTo: num(env, 'HISTORY_TRIM_TO', 10),
  };
  if (history.trimTo < 1 || history.trimTo >= history.limit) {
    throw new Error(
      `HISTORY_TRIM_TO must be at least 1 and less than HISTORY_LIMIT (${history.limit}), got ${history.trimTo}`,
    );
  }

  const randomReplyChance = num(env, 'RANDOM_REPLY_CHANCE', 0.02);
  if (randomReplyChance < 0 || randomReplyChance > 1) {
    throw new Error(`RANDOM_REPLY_CHANCE must be between 0 and 1, got ${randomReplyChance}`);
  }

  const credits = {
    enabled: (env.CREDITS_ENABLED ?? 'true') !== 'false',
    min: num(env, 'CREDITS_MIN', 15),
    max: num(env, 'CREDITS_MAX', 25),
    cooldownSeconds: num(env, 'CREDITS_COOLDOWN_SECONDS', 30),
    minChars: num(env, 'CREDITS_MIN_CHARS', 3),
    announceLevelUp: (env.CREDITS_ANNOUNCE_LEVEL_UP ?? 'true') !== 'false',
    flushMs: num(env, 'CREDITS_FLUSH_MS', 2000),
  };
  if (credits.min > credits.max) {
    throw new Error(`CREDITS_MIN must not exceed CREDITS_MAX (${credits.max}), got ${credits.min}`);
  }
  if (credits.min < 0) {
    throw new Error(`CREDITS_MIN must not be negative, got ${credits.min}`);
  }
  if (credits.cooldownSeconds < 0) {
    throw new Error(`CREDITS_COOLDOWN_SECONDS must not be negative, got ${credits.cooldownSeconds}`);
  }
  if (credits.minChars < 0) {
    throw new Error(`CREDITS_MIN_CHARS must not be negative, got ${credits.minChars}`);
  }
  if (credits.flushMs < 0) {
    throw new Error(`CREDITS_FLUSH_MS must not be negative, got ${credits.flushMs}`);
  }

  return {
    discord: {
      token: env.DISCORD_BOT_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      allowedChannels: channels,
    },
    llm: loadLlmConfig(env),
    history,
    trigger: {
      similarityFloor: num(env, 'TRIGGER_SIMILARITY_FLOOR', 0.65),
      // Applies only to random chime-ins. Anything aimed at Lu is always
      // answered; a cooldown there would block following a conversation.
      cooldownSeconds: num(env, 'TRIGGER_COOLDOWN_SECONDS', 60),
      enabled: (env.TRIGGER_ENABLED ?? 'true') !== 'false',
      maxQuoteChars: num(env, 'MAX_QUOTE_CHARS', 400),
      keywords: list(env, 'TRIGGER_KEYWORDS', 'lu,ai bot'),
      randomReplyChance,
      windowMessages: num(env, 'ATTENTION_WINDOW_MESSAGES', 8),
      windowMinutes: num(env, 'ATTENTION_WINDOW_MINUTES', 5),
      pauseSeconds: num(env, 'PAUSE_SECONDS', 3),
      // Live check (2026-09-11): an unbounded judge prompt on a real
      // conversation took ~28s to read at ~25 tok/s on the deployment host,
      // always missing 15s. The prompt is now bounded per line (see
      // ADDRESSEE_LINE_CHARS in src/addressee.js) to ~250-300 tokens, ~12s
      // cold; 30s adds headroom for queueing behind a reply on a host that
      // runs one model job at a time, not a new normal.
      addresseeTimeoutSeconds: num(env, 'ADDRESSEE_TIMEOUT_SECONDS', 30),
    },
    reply: {
      timeoutSeconds: num(env, 'REPLY_TIMEOUT_SECONDS', 90),
      maxTokens: num(env, 'REPLY_MAX_TOKENS', 120),
    },
    nickname: {
      enabled: (env.NICKNAME_ENABLED ?? 'true') !== 'false',
      // Matches the original bot: only members with Manage Nicknames may ask.
      // Can be turned off to let anyone ask.
      requirePermission: (env.NICKNAME_REQUIRE_PERMISSION ?? 'true') !== 'false',
    },
    credits,
  };
}

// Configuration that parses cleanly but leaves the bot unable to do anything.
// .env.example ships DISCORD_ALLOWED_CHANNELS empty, and with it empty
// shouldObserve rejects every message — so the bot connects, reports itself
// online, and ignores everyone, with nothing anywhere explaining why.
export function startupWarnings(config) {
  const warnings = [];
  if (config.discord.allowedChannels.length === 0) {
    warnings.push(
      'DISCORD_ALLOWED_CHANNELS is empty: the bot will respond to nothing. ' +
      'Set it to a comma-separated list of channel IDs it may read and speak in.',
    );
  }
  return warnings;
}
