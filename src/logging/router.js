// Discord's answer when the channel itself is the problem: it is gone, or Lu
// cannot see or post in it. Retrying on every message would fill the log
// with the same error, so the route is switched off once and /log status
// says why. Anything else (a timeout, a hiccup) is logged and forgotten.
const PERMANENT = new Set([10003, 50001, 50013]);

export function createLogRouter({ logSettings, send, now = Date.now }) {
  return {
    async post(guildId, category, payload, { channelId = null, authorRoleIds = [] } = {}) {
      const route = logSettings.route(guildId, category);
      if (!route) return 'off';
      if (channelId && (logSettings.isIgnoredChannel(guildId, channelId) || logSettings.isLogChannel(guildId, channelId))) {
        return 'ignored';
      }
      if (authorRoleIds.some((id) => logSettings.isIgnoredRole(guildId, id))) return 'ignored';
      try {
        await send(route, payload);
        return 'sent';
      } catch (err) {
        if (PERMANENT.has(err.code)) {
          logSettings.markBroken(guildId, category, { channelId: route, reason: err.message, at: now() });
          console.error(`Logging: the ${category} log in channel ${route} is switched off: ${err.message}`);
          return 'broken';
        }
        console.error(`Logging: could not post a ${category} entry:`, err);
        return 'failed';
      }
    },
  };
}
