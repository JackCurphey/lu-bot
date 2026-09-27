// Per-guild, per-feature settings (src/settings.js). The value is JSON text so
// one table holds strings, numbers, id lists and small objects alike.
export default {
  version: 1,
  name: 'settings',
  up(db) {
    db.exec(`
      CREATE TABLE settings (
        guild_id TEXT NOT NULL,
        feature  TEXT NOT NULL,
        key      TEXT NOT NULL,
        value    TEXT NOT NULL,
        PRIMARY KEY (guild_id, feature, key)
      )
    `);
  },
};
