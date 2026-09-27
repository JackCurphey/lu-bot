import { Client, GatewayIntentBits, Events, PermissionsBitField, MessageFlags, ApplicationCommandOptionType } from 'discord.js';
import { matchesMemberName } from './rename.js';

// Every message in an allowed channel is passed on, so Lu can follow the
// conversation. Whether he answers is decided later, in attention.js.
// Two ways in, unioned. A channel named in allowedChannels is always observed
// -- naming a channel is a deliberate act, so it wins even outside an allowed
// server. Otherwise the server rule applies: everywhere in an allowed server
// except the channels named in deniedChannels. Listing every channel by id
// went stale the moment someone added one, which is why the server rule exists.
export function shouldObserve(view, { botId, allowedChannels, allowedGuilds = [], deniedChannels = [] }) {
  if (view.author.id === botId) return false;
  if (allowedChannels.includes(view.channelId)) return true;
  // A direct message has no guild, so guildId is null and matches no entry in
  // allowedGuilds -- no explicit guard needed, and one was removed here after a
  // mutation check showed it could be deleted without failing any test.
  return allowedGuilds.includes(view.guildId) && !deniedChannels.includes(view.channelId);
}

// Discord refuses the whole login (close code 4014) when a privileged intent
// is requested but not enabled in the Developer Portal -- chat would go down
// with it. So Server Members (privileged) is requested only when a feature
// that needs member events is on, and the portal switch is a precondition of
// turning that feature on, not of deploying.
export function intentsFor(config) {
  const f = config.features ?? {};
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ];
  if (f.moderation || f.logging || f.welcome) intents.push(GatewayIntentBits.GuildMembers);
  // Bans, unbans and audit-log entries. Not privileged.
  if (f.moderation || f.logging) intents.push(GatewayIntentBits.GuildModeration);
  return intents;
}

export const LU_NAME = 'Lu';

export function toEntry(view, { botId }) {
  const names = new Map(view.mentionedUsers.map((u) => [u.id, u.displayName]));
  // Mention tags are rendered, not deleted: deleting them left a bare "@Lu"
  // message empty, which the model server rejects with HTTP 400.
  const text = view.content
    .replace(/<@!?(\d+|[A-Za-z0-9_-]+)>/g, (_, id) => `@${id === botId ? LU_NAME : (names.get(id) ?? 'someone')}`)
    .trim();
  const mentionedIds = view.mentionedUsers.map((u) => u.id);

  return {
    messageId: view.id,
    channelId: view.channelId,
    authorId: view.author.id,
    name: view.author.displayName,
    isBot: view.author.bot,
    isLu: view.author.id === botId,
    mentionsLu: mentionedIds.includes(botId),
    mentionsOthers: mentionedIds.some((id) => id !== botId),
    repliesToLu: view.repliedUserId === botId,
    repliesToOther: view.repliedUserId != null && view.repliedUserId !== botId,
    at: view.createdTimestamp,
    text,
    // Default false when absent so existing test fixtures (built before this
    // task) keep working without adding these two fields to every one.
    authorCanManageNicknames: view.authorCanManageNicknames ?? false,
    inGuild: view.inGuild ?? false,
    // Which server this came from. Null in a direct message.
    guildId: view.guildId ?? null,
    // The rendered text above loses the ids, which "lu credits @someone" needs
    // to know who was meant. Carried separately rather than parsed back out of
    // the text: a display name is not a key and two members can share one.
    mentions: view.mentionedUsers.map((u) => ({ id: u.id, name: u.displayName })),
    // Which of those mentions is Lu. Carried on the entry rather than threaded
    // through createConversation, which every other consumer would have had to
    // accept and ignore.
    luId: botId,
  };
}

export function createChannelIo(channel) {
  return {
    // A plain message, not a Discord reply (user's choice), and one that can
    // never ping @everyone or a user whatever the model writes.
    async send(text) {
      const sent = await channel.send({ content: text, allowedMentions: { parse: [] } });
      return sent?.id ?? null;
    },
    startTyping: () => startTyping({ channel }),
    // null clears the nickname (back to the default name).
    async applyNickname(name) {
      const me = channel.guild?.members?.me;
      if (!me) return { ok: false, reason: 'notInGuild' };
      try {
        await me.setNickname(name);
        return { ok: true };
      } catch (err) {
        console.warn(`Nickname change refused: ${err.message}`);
        return { ok: false, reason: 'refused' };
      }
    },
    // Someone else's nickname; null clears it. Discord only lets Lu rename a
    // member whose highest role sits below his, and never the server owner --
    // `manageable` is discord.js's own check of exactly that, so an outranked
    // rename gets its own line instead of a generic refusal.
    async renameMember(userId, name) {
      const guild = channel.guild;
      if (!guild) return { ok: false, reason: 'notInGuild' };
      try {
        const member = await guild.members.fetch(userId);
        if (!member.manageable) return { ok: false, reason: 'outranked' };
        await member.setNickname(name);
        return { ok: true };
      } catch (err) {
        console.warn(`Rename of ${userId} refused: ${err.message}`);
        return { ok: false, reason: 'refused' };
      }
    },
    // Discord's member search matches the start of a username or nickname, so
    // its results are narrowed to exact matches here. Throws if the search
    // itself fails; the caller decides what that means.
    async findMembers(typed) {
      const guild = channel.guild;
      if (!guild) return [];
      const found = await guild.members.search({ query: typed, limit: 10 });
      return [...found.values()]
        .filter((m) => matchesMemberName({
          displayName: m.displayName, nickname: m.nickname,
          username: m.user?.username, globalName: m.user?.globalName,
        }, typed))
        .map((m) => ({ id: m.id, name: m.displayName }));
    },
  };
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

// A slash command as plain data, so command handlers never touch discord.js.
// Resolved options carry an id and a display name; everything else is its
// raw value.
export function interactionView(interaction) {
  const options = {};
  for (const o of interaction.options?.data ?? []) {
    if (o.type === ApplicationCommandOptionType.User) {
      options[o.name] = { id: o.user.id, name: o.member?.displayName ?? o.user.displayName };
    } else if (o.channel) {
      options[o.name] = { id: o.channel.id, name: o.channel.name };
    } else if (o.role) {
      options[o.name] = { id: o.role.id, name: o.role.name };
    } else {
      options[o.name] = o.value;
    }
  }
  return {
    commandName: interaction.commandName,
    guildId: interaction.guildId ?? null,
    channelId: interaction.channelId,
    user: { id: interaction.user.id, name: interaction.member?.displayName ?? interaction.user.displayName },
    memberPermissions: interaction.memberPermissions?.toArray() ?? [],
    options,
  };
}

// Private unless told otherwise, and never able to ping -- a reason typed by
// a moderator can contain @everyone.
export function createInteractionIo(interaction) {
  return {
    async reply(body, { ephemeral = true } = {}) {
      const payload = {
        ...body,
        allowedMentions: { parse: [] },
        ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
      };
      if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
      return interaction.reply(payload);
    },
  };
}

// What the message store keeps. Bots and system messages ("X pinned a
// message") are not worth keeping; direct messages are not server business.
export function messageRecordOf(message) {
  if (!message.guildId || message.author?.bot || message.system) return null;
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.displayName,
    text: message.content ?? '',
    attachments: [...(message.attachments?.values() ?? [])].map((a) => a.name),
    at: message.createdTimestamp,
  };
}

// Guild commands appear immediately (global ones can take an hour). A failure
// in one guild -- most likely Lu was invited without the commands scope -- is
// logged and does not stop the others or the bot.
export async function registerGuildCommands({ client, guildIds, definitions }) {
  for (const id of guildIds) {
    try {
      const guild = await client.guilds.fetch(id);
      await guild.commands.set(definitions);
      console.log(`Registered ${definitions.length} slash command(s) in guild ${id}.`);
    } catch (err) {
      console.warn(`Could not register slash commands in guild ${id}: ${err.message}`);
    }
  }
}

function viewOf(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author.id,
      bot: message.author.bot,
      displayName: message.member?.displayName ?? message.author.displayName,
    },
    content: message.content,
    mentionedUsers: [...message.mentions.users.values()].map((u) => ({
      id: u.id,
      displayName: message.mentions.members?.get(u.id)?.displayName ?? u.displayName,
    })),
    repliedUserId: message.mentions.repliedUser?.id ?? null,
    createdTimestamp: message.createdTimestamp,
    authorCanManageNicknames: message.member?.permissions?.has(PermissionsBitField.Flags.ManageNicknames) ?? false,
    inGuild: Boolean(message.guild),
    guildId: message.guild?.id ?? null,
  };
}

export async function startBot({ config, onMessage, commands = null, guildEvents = null, messageStore = null }) {
  const client = new Client({
    intents: intentsFor(config),
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
    // Recorded before the chat filter: logging needs every channel in the
    // server, not only the ones Lu chats in.
    if (messageStore && config.discord.allowedGuilds.includes(message.guildId)) {
      try {
        const record = messageRecordOf(message);
        if (record) messageStore.record(record);
      } catch (err) {
        console.error('Failed to record message:', err);
      }
    }
    const view = viewOf(message);
    if (!shouldObserve(view, {
      botId: client.user.id,
      allowedChannels: config.discord.allowedChannels,
      allowedGuilds: config.discord.allowedGuilds,
      deniedChannels: config.discord.deniedChannels,
    })) {
      return;
    }
    try {
      await onMessage(toEntry(view, { botId: client.user.id }), createChannelIo(message.channel));
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  });

  if (messageStore) {
    client.on(Events.MessageUpdate, (_before, after) => {
      try {
        if (after.content != null) messageStore.updateText(after.id, after.content);
      } catch (err) {
        console.error('Failed to update stored message:', err);
      }
    });
  }

  if (commands) {
    client.once(Events.ClientReady, () => registerGuildCommands({
      client, guildIds: config.discord.allowedGuilds, definitions: commands.definitions(),
    }));
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      try {
        await commands.handle(interactionView(interaction), createInteractionIo(interaction));
      } catch (err) {
        console.error('Failed to handle command:', err);
      }
    });
  }

  if (guildEvents) {
    // Each discord.js event is forwarded as-is to the features that listen.
    // Features that need plain data build it themselves (WP-2 onwards), so
    // this layer stays a pass-through and the guild scoping lives in one place.
    const forward = (event, name, guildOf) => {
      client.on(event, async (...args) => {
        if (!guildEvents.has(name)) return;
        try {
          await guildEvents.emit(name, guildOf(...args), args.length === 1 ? args[0] : args);
        } catch (err) {
          console.error(`Failed to forward ${name}:`, err);
        }
      });
    };
    forward(Events.GuildMemberAdd, 'memberAdd', (m) => m.guild.id);
    forward(Events.GuildMemberRemove, 'memberRemove', (m) => m.guild.id);
    forward(Events.GuildMemberUpdate, 'memberUpdate', (_before, after) => after.guild.id);
    forward(Events.GuildBanAdd, 'banAdd', (ban) => ban.guild.id);
    forward(Events.GuildBanRemove, 'banRemove', (ban) => ban.guild.id);
    forward(Events.MessageUpdate, 'messageUpdate', (_before, after) => after.guildId);
    forward(Events.MessageDelete, 'messageDelete', (m) => m.guildId);
    forward(Events.MessageBulkDelete, 'messageBulkDelete', (messages, channel) => channel.guildId);
    forward(Events.GuildAuditLogEntryCreate, 'auditLogEntry', (_entry, guild) => guild.id);
  }

  await client.login(config.discord.token);
  return client;
}
