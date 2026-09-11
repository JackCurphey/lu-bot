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
      addresseeTimeoutSeconds: num(env, 'ADDRESSEE_TIMEOUT_SECONDS', 15),
    },
    reply: {
      timeoutSeconds: num(env, 'REPLY_TIMEOUT_SECONDS', 90),
    },
  };
}

// Configuration that parses cleanly but leaves the bot unable to do anything.
// .env.example ships DISCORD_ALLOWED_CHANNELS empty, and with it empty
// shouldHandle rejects every message — so the bot connects, reports itself
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
