// Recent message text, in memory only. Discord does not send the text of a
// deleted message, and sends only the new text of an edited one; this is
// where the old text comes from (logging) and where a case's "last 5
// messages" come from (moderation). A restart empties it -- the README
// promises message history is not kept on disk.
//
// A Map keeps insertion order, so the first key is always the oldest: the cap
// evicts from the front, and expiry is checked lazily on read.
export function createMessageStore({ ttlMs = 86_400_000, max = 10_000, now = Date.now } = {}) {
  const byId = new Map();

  const expired = (m) => now() - m.at > ttlMs;
  const copy = (m) => ({ ...m, attachments: [...m.attachments], authorRoleIds: [...(m.authorRoleIds ?? [])] });

  function live(id) {
    const m = byId.get(id);
    if (!m) return null;
    if (expired(m)) {
      byId.delete(id);
      return null;
    }
    return m;
  }

  return {
    record(msg) {
      byId.delete(msg.id);
      byId.set(msg.id, copy(msg));
      while (byId.size > max) byId.delete(byId.keys().next().value);
    },
    get(id) {
      const m = live(id);
      return m ? copy(m) : null;
    },
    updateText(id, text) {
      const m = live(id);
      if (!m) return null;
      const before = copy(m);
      m.text = text;
      return before;
    },
    forget(id) {
      const m = live(id);
      if (!m) return null;
      byId.delete(id);
      return copy(m);
    },
    recentByAuthor(guildId, authorId, n) {
      const out = [];
      for (const m of [...byId.values()].reverse()) {
        if (out.length >= n) break;
        if (m.guildId === guildId && m.authorId === authorId && !expired(m)) out.push(copy(m));
      }
      return out;
    },
    size: () => byId.size,
  };
}
