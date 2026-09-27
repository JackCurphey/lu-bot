import { ApplicationCommandOptionType, ChannelType } from 'discord.js';
import { LOG_CATEGORIES } from './settings.js';

const LABEL = {
  messages: 'Message logs',
  members: 'Member logs',
  memberChanges: 'Member change logs',
  moderation: 'Moderation logs',
};
const CHOICE_NAME = { messages: 'messages', members: 'members', memberChanges: 'member changes', moderation: 'moderation' };

const categoryOption = {
  type: ApplicationCommandOptionType.String,
  name: 'category',
  description: 'Which kind of log',
  required: true,
  choices: LOG_CATEGORIES.map((value) => ({ name: CHOICE_NAME[value], value })),
};
const textChannel = (description, required) => ({
  type: ApplicationCommandOptionType.Channel,
  name: 'channel',
  description,
  required,
  channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
});
const roleOption = { type: ApplicationCommandOptionType.Role, name: 'role', description: 'A role', required: false };
const sub = (name, description, options = []) => ({ type: ApplicationCommandOptionType.Subcommand, name, description, options });

// 'EmbedLinks' -> 'Embed Links'.
const splitCamel = (name) => name.replace(/([A-Z])/g, ' $1').trim();

export function createLogCommand({ logSettings, send, missingPermissions }) {
  const one = (o) => {
    const picked = [o.channel ? 'channel' : null, o.role ? 'role' : null].filter(Boolean);
    return picked.length === 1 ? picked[0] : null;
  };

  return {
    name: 'log',
    description: 'Choose where Lu posts server logs',
    permission: 'ManageGuild',
    options: [
      sub('channel', 'Send one kind of log to a channel', [categoryOption, textChannel('Where the log goes', true)]),
      sub('off', 'Stop one kind of log', [categoryOption]),
      sub('ignore', "Don't log messages from a channel or a role", [textChannel('A channel to ignore', false), roleOption]),
      sub('unignore', 'Log messages from a channel or a role again', [textChannel('A channel', false), roleOption]),
      sub('status', 'Show where each log goes'),
    ],

    async run({ view, reply }) {
      const g = view.guildId;
      const o = view.options ?? {};
      switch (view.subcommand) {
        case 'channel': {
          // Real entries are embeds, and bulk deletes carry a file -- caught
          // here, before the test line, so a channel missing Embed Links or
          // Attach Files is never saved as a route that will fail later.
          try {
            const missing = await missingPermissions(o.channel.id);
            if (missing.length > 0) {
              await reply({ content: `I need these permissions in <#${o.channel.id}> first: ${missing.map(splitCamel).join(', ')}` });
              return;
            }
          } catch (err) {
            await reply({ content: `I can't post in <#${o.channel.id}> (${err.message}). Check my permissions there and try again.` });
            return;
          }
          // A test line too: a channel Lu cannot post in is caught now, not
          // on the first deleted message.
          try {
            await send(o.channel.id, { content: `${LABEL[o.category]} will be posted here.` });
          } catch (err) {
            await reply({ content: `I can't post in <#${o.channel.id}> (${err.message}). Check my permissions there and try again.` });
            return;
          }
          logSettings.setRoute(g, o.category, o.channel.id);
          await reply({ content: `${LABEL[o.category]} will go to <#${o.channel.id}>.` });
          return;
        }
        case 'off': {
          logSettings.clearRoute(g, o.category);
          await reply({ content: `${LABEL[o.category]} are off.` });
          return;
        }
        case 'ignore':
        case 'unignore': {
          const kind = one(o);
          if (!kind) {
            await reply({ content: 'Give me one channel or one role.' });
            return;
          }
          const mention = kind === 'channel' ? `<#${o.channel.id}>` : `<@&${o.role.id}>`;
          const id = o[kind].id;
          const changed = view.subcommand === 'ignore'
            ? (kind === 'channel' ? logSettings.ignoreChannel(g, id) : logSettings.ignoreRole(g, id))
            : (kind === 'channel' ? logSettings.unignoreChannel(g, id) : logSettings.unignoreRole(g, id));
          const text = view.subcommand === 'ignore'
            ? (changed ? `I'll no longer log messages from ${mention}.` : `I'm already ignoring ${mention}.`)
            : (changed ? `I will log messages from ${mention} again.` : `I wasn't ignoring ${mention}.`);
          await reply({ content: text });
          return;
        }
        case 'status': {
          const lines = LOG_CATEGORIES.map((c) => {
            const route = logSettings.route(g, c);
            if (route) return `${LABEL[c]}: <#${route}>`;
            const broken = logSettings.broken(g, c);
            return broken
              ? `${LABEL[c]}: off, switched off after an error in <#${broken.channelId}> (${broken.reason}). Set it again with /log channel.`
              : `${LABEL[c]}: off`;
          });
          const { channels, roles } = logSettings.ignored(g);
          lines.push(`Ignored channels: ${channels.length ? channels.map((id) => `<#${id}>`).join(' ') : 'none'}`);
          lines.push(`Ignored roles: ${roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : 'none'}`);
          lines.push('Moderation logs start when moderation is switched on. Who deleted a message is not shown yet.');
          await reply({ content: lines.join('\n') });
          return;
        }
        default:
          await reply({ content: "I don't know that /log option." });
      }
    },
  };
}
