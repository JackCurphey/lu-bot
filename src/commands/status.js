// The one command WP-1 ships: proof that slash commands register and route,
// and a quick look at which server features are switched on.
const LABELS = { moderation: 'moderation', logging: 'logging', welcome: 'welcome', roleMenus: 'role menus' };

export function createStatusCommand({ version, features, databaseOk }) {
  return {
    name: 'lu-status',
    description: "Lu's version and which of his server features are switched on",
    // Open to everyone: version and switches only. Moderation commands keep
    // their limits.
    permission: null,
    async run({ reply }) {
      const lines = [
        `Lu v${version}`,
        ...Object.entries(LABELS).map(([key, label]) => `${label}: ${features[key] ? 'on' : 'off'}`),
        `database: ${databaseOk ? 'ok' : 'not available'}`,
      ];
      await reply({ content: lines.join('\n') }, { ephemeral: true });
    },
  };
}
