import { messageView } from './views.js';
import { formatMessageDeleted, formatMessageEdited, formatBulkDelete } from './format.js';

// Text comes from the message store first (Lu saw it arrive), then from
// discord.js's own cache, else it is "not available". The store never holds
// bot messages, so a stored message is a human's.
export function createMessageLogHandlers({ router, messageStore, now = Date.now }) {
  return {
    async onDelete(message, { guildId }) {
      const v = messageView(message);
      const kept = messageStore?.forget(v.messageId) ?? null;
      if (!kept && v.authorIsBot) return;
      const record = {
        messageId: v.messageId,
        channelId: v.channelId,
        authorId: kept?.authorId ?? v.authorId,
        authorName: kept?.authorName ?? v.authorName,
        text: kept ? kept.text : v.text,
        attachments: kept?.attachments ?? v.attachments,
      };
      await router.post(guildId, 'messages', formatMessageDeleted(record, { now }), {
        channelId: v.channelId,
        authorRoleIds: kept?.authorRoleIds ?? v.authorRoleIds ?? [],
      });
    },

    // Runs before the store takes the new text (WP-1 F2), so get() still has
    // the old one.
    async onEdit([before, after], { guildId }) {
      if (after.author?.bot) return;
      const newText = after.content ?? null;
      if (newText == null) return;
      const kept = messageStore?.get(after.id) ?? null;
      const oldText = kept ? kept.text : (before && !before.partial ? before.content ?? null : null);
      if (oldText === newText) return;
      const v = messageView(after);
      await router.post(guildId, 'messages', formatMessageEdited({
        messageId: v.messageId,
        guildId,
        channelId: v.channelId,
        authorId: v.authorId ?? kept?.authorId ?? null,
        authorName: v.authorName ?? kept?.authorName ?? null,
        before: oldText,
        after: newText,
      }, { now }), {
        channelId: v.channelId,
        authorRoleIds: kept?.authorRoleIds ?? v.authorRoleIds ?? [],
      });
    },

    async onBulkDelete([messages, channel], { guildId }) {
      const entries = [];
      for (const message of messages.values()) {
        const v = messageView(message);
        const kept = messageStore?.forget(v.messageId) ?? null;
        if (!kept && v.authorIsBot) continue;
        entries.push({
          id: v.messageId,
          authorId: kept?.authorId ?? v.authorId,
          authorName: kept?.authorName ?? v.authorName,
          text: kept ? kept.text : v.text,
          at: kept?.at ?? v.at,
        });
      }
      if (entries.length === 0) return;
      entries.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
      await router.post(guildId, 'messages', formatBulkDelete({ channelId: channel.id, messages: entries }, { now }), {
        channelId: channel.id,
      });
    },
  };
}
