// discord.js objects -> plain records. Deleted and uncached ("partial")
// objects arrive with most fields null, so every read here is defensive.

// Null means "not known" (an uncached member), which is not the same as "no
// roles". The @everyone role's id is the guild id and is left out.
export function roleIdsOf(member, guildId) {
  const cache = member?.roles?.cache;
  if (!cache) return null;
  return [...cache.keys()].filter((id) => id !== guildId);
}

export function messageView(message) {
  return {
    messageId: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    authorId: message.author?.id ?? null,
    authorName: message.member?.displayName ?? message.author?.displayName ?? null,
    authorIsBot: message.author?.bot ?? null,
    text: message.partial ? null : (message.content ?? null),
    attachments: [...(message.attachments?.values() ?? [])].map((a) => a.name),
    authorRoleIds: roleIdsOf(message.member, message.guildId),
    at: message.createdTimestamp ?? null,
  };
}
