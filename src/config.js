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

  return {
    discord: {
      token: env.DISCORD_BOT_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      allowedChannels: channels,
    },
    llm: loadLlmConfig(env),
    trigger: {
      similarityFloor: num(env, 'TRIGGER_SIMILARITY_FLOOR', 0.65),
      cooldownSeconds: num(env, 'TRIGGER_COOLDOWN_SECONDS', 180),
      enabled: (env.TRIGGER_ENABLED ?? 'true') !== 'false',
      maxQuoteChars: num(env, 'MAX_QUOTE_CHARS', 400),
    },
  };
}
