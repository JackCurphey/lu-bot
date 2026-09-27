// Server-wide events, fanned out to whichever features listen. Scoped to the
// managed guilds (DISCORD_ALLOWED_GUILDS): an explicitly allowed channel in
// another server gets chat, never moderation or logging.
export const GUILD_EVENTS = Object.freeze([
  'memberAdd', 'memberRemove', 'memberUpdate',
  'banAdd', 'banRemove',
  'messageUpdate', 'messageDelete', 'messageBulkDelete',
  'auditLogEntry',
]);

export function createGuildEvents({ managedGuilds }) {
  const handlers = new Map(GUILD_EVENTS.map((name) => [name, []]));

  return {
    on(name, handler) {
      if (!handlers.has(name)) throw new Error(`Unknown guild event "${name}"`);
      handlers.get(name).push(handler);
    },
    has: (name) => (handlers.get(name)?.length ?? 0) > 0,
    async emit(name, guildId, payload) {
      if (!guildId || !managedGuilds.includes(guildId)) return;
      for (const handler of handlers.get(name) ?? []) {
        // Each feature's failure stays its own: logging breaking must not stop
        // moderation recording the same ban.
        try {
          await handler(payload, { guildId });
        } catch (err) {
          console.error(`Guild event ${name} handler failed:`, err);
        }
      }
    },
  };
}
