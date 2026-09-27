// Per-guild, per-feature configuration. The only way a feature reads its
// settings, so the web page (sub-project 6) can later write the same rows.
export function createSettings(db) {
  const getStmt = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND feature = ? AND key = ?');
  const setStmt = db.prepare(`
    INSERT INTO settings (guild_id, feature, key, value) VALUES (?, ?, ?, ?)
    ON CONFLICT (guild_id, feature, key) DO UPDATE SET value = excluded.value
  `);
  const removeStmt = db.prepare('DELETE FROM settings WHERE guild_id = ? AND feature = ? AND key = ?');
  const allStmt = db.prepare('SELECT key, value FROM settings WHERE guild_id = ? AND feature = ? ORDER BY key');

  return {
    get(guildId, feature, key, fallback = null) {
      const row = getStmt.get(guildId, feature, key);
      return row ? JSON.parse(row.value) : fallback;
    },
    set(guildId, feature, key, value) {
      // JSON.stringify(undefined) is undefined, which would bind as NULL and
      // break the NOT NULL column with an unhelpful message.
      if (value === undefined) throw new Error(`Setting ${feature}.${key} cannot be undefined; use remove()`);
      setStmt.run(guildId, feature, key, JSON.stringify(value));
    },
    remove(guildId, feature, key) {
      removeStmt.run(guildId, feature, key);
    },
    all(guildId, feature) {
      const out = {};
      for (const row of allStmt.all(guildId, feature)) out[row.key] = JSON.parse(row.value);
      return out;
    },
  };
}
