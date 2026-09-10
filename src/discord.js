import { Client, GatewayIntentBits, Events } from 'discord.js';

export function shouldHandle(msg, { botId, allowedChannels }) {
  if (msg.authorIsBot) return false;
  if (msg.authorId === botId) return false;
  if (!allowedChannels.includes(msg.channelId)) return false;
  return msg.mentionsBot === true;
}

// Discord rejects a message body over 2000 characters with
// DiscordAPIError[50035]. That throw lands in the adapter's catch below and
// the user gets silence, which is indistinguishable from the bot deciding it
// had nothing to say. 1900 leaves headroom for Discord's own accounting.
export const DISCORD_REPLY_LIMIT = 1900;

const ELLIPSIS = '…';

// Sentence and line boundaries, so a truncated reply ends somewhere a reader
// would stop rather than mid-word. Falls back to a hard cut when the only
// boundary found is so early that honouring it would throw most of the reply
// away.
export function truncateForDiscord(text, limit = DISCORD_REPLY_LIMIT) {
  const s = String(text ?? '');
  if (s.length <= limit) return s;

  const head = s.slice(0, limit - ELLIPSIS.length);
  const boundary = Math.max(
    head.lastIndexOf('\n'),
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
  );
  const cut = boundary >= Math.floor(limit / 2) ? head.slice(0, boundary + 1) : head;
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

// Discord's typing indicator expires after roughly ten seconds. A reply on the
// deployment host takes 13-15s, and ~25s on the first message after a restart,
// so one sendTyping() would lapse before the reply lands and the channel would
// show nothing — indistinguishable from Lu ignoring the message.
export const TYPING_REFRESH_MS = 8000;

export function startTyping({
  channel,
  intervalMs = TYPING_REFRESH_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  // Cosmetic. A failure here must never propagate into the reply path, so
  // every call swallows its own rejection.
  const send = () => { Promise.resolve(channel.sendTyping()).catch(() => {}); };

  send();
  const id = setIntervalImpl(send, intervalMs);
  // Node holds the event loop open for a pending interval. Nothing here should
  // keep the process alive on its own.
  if (typeof id?.unref === 'function') id.unref();

  return { stop: () => clearIntervalImpl(id) };
}

export async function startBot({ config, onMention }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Client is an EventEmitter, and an 'error' event with no listener is
  // re-thrown by Node and kills the process. A routine gateway hiccup would
  // otherwise take the bot down silently. Logging only — no reconnection
  // logic here; discord.js does its own, and anything beyond that is a
  // process manager's job.
  client.on(Events.Error, (err) => {
    console.error('Discord client error:', err);
  });

  client.on(Events.MessageCreate, async (message) => {
    const view = {
      authorId: message.author.id,
      authorIsBot: message.author.bot,
      channelId: message.channelId,
      mentionsBot: message.mentions.users.has(client.user.id),
    };
    if (!shouldHandle(view, { botId: client.user.id, allowedChannels: config.discord.allowedChannels })) {
      return;
    }

    const content = message.content.replace(/<@!?\d+>/g, '').trim();
    const typing = startTyping({ channel: message.channel });
    try {
      const reply = await onMention({ content, channelId: message.channelId, authorId: message.author.id });
      if (reply) await message.reply(truncateForDiscord(reply));
    } catch (err) {
      console.error('Failed to handle mention:', err);
    } finally {
      // finally, not the try body: a dropped reply and a thrown error must
      // both stop the indicator.
      typing.stop();
    }
  });

  await client.login(config.discord.token);
  return client;
}
