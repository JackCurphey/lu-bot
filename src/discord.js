import { Client, GatewayIntentBits, Events } from 'discord.js';

export function shouldHandle(msg, { botId, allowedChannels }) {
  if (msg.authorIsBot) return false;
  if (msg.authorId === botId) return false;
  if (!allowedChannels.includes(msg.channelId)) return false;
  return msg.mentionsBot === true;
}

export async function startBot({ config, onMention }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
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
    try {
      const reply = await onMention({ content, channelId: message.channelId, authorId: message.author.id });
      if (reply) await message.reply(reply);
    } catch (err) {
      console.error('Failed to handle mention:', err);
    }
  });

  await client.login(config.discord.token);
  return client;
}
