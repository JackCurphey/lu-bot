import { truncateForDiscord } from '../discord.js';

// Discord embed limits: description 4096, field value 1024. Kept under them.
const DESCRIPTION_LIMIT = 4000;
const FIELD_LIMIT = 1024;

export const COLORS = Object.freeze({
  deleted: 0xED4245,
  edited: 0xFEE75C,
  joined: 0x57F287,
  left: 0x99AAB5,
  changed: 0x5865F2,
});

const NOT_AVAILABLE = '*Text not available: sent before Lu last restarted, or more than 24 hours ago.*';

const field = (name, value, inline = false) => ({ name, value: truncateForDiscord(value || '—', FIELD_LIMIT), inline });
const who = (id, name) => (id ? `<@${id}> (${name ?? 'unknown'})` : 'unknown');
const stamp = (now) => new Date(now()).toISOString();

export function formatMessageDeleted({ messageId, channelId, authorId, authorName, text, attachments = [] }, { now = Date.now } = {}) {
  const fields = [field('Author', who(authorId, authorName), true), field('Channel', `<#${channelId}>`, true)];
  if (attachments.length > 0) fields.push(field('Attachments', attachments.join(', ')));
  return {
    embeds: [{
      title: 'Message deleted',
      color: COLORS.deleted,
      description: text == null ? NOT_AVAILABLE : truncateForDiscord(text || '*(no text)*', DESCRIPTION_LIMIT),
      fields,
      footer: { text: `Message ID ${messageId}${authorId ? ` · Author ID ${authorId}` : ''}` },
      timestamp: stamp(now),
    }],
  };
}

export function formatMessageEdited({ messageId, guildId, channelId, authorId, authorName, before, after }, { now = Date.now } = {}) {
  return {
    embeds: [{
      title: 'Message edited',
      color: COLORS.edited,
      description: `[Jump to message](https://discord.com/channels/${guildId}/${channelId}/${messageId}) in <#${channelId}>`,
      fields: [
        field('Author', who(authorId, authorName)),
        field('Before', before == null ? NOT_AVAILABLE : before),
        field('After', after),
      ],
      footer: { text: `Message ID ${messageId}${authorId ? ` · Author ID ${authorId}` : ''}` },
      timestamp: stamp(now),
    }],
  };
}

export function formatBulkDelete({ channelId, messages }, { now = Date.now } = {}) {
  const known = messages.filter((m) => m.text != null).length;
  const lines = messages.map((m) => (m.text == null
    ? `message ${m.id}: text not available`
    : `${m.at != null ? new Date(m.at).toISOString() : 'unknown time'} ${m.authorName ?? 'unknown'} (${m.authorId ?? '?'}): ${m.text}`));
  const count = messages.length;
  return {
    embeds: [{
      title: `${count} ${count === 1 ? 'message' : 'messages'} deleted`,
      color: COLORS.deleted,
      description: `Lu had the text for ${known} of ${count}. The full list is attached.`,
      fields: [field('Channel', `<#${channelId}>`)],
      timestamp: stamp(now),
    }],
    files: [{ attachment: Buffer.from(lines.join('\n'), 'utf8'), name: 'deleted-messages.txt' }],
  };
}
