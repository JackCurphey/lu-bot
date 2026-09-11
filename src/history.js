// Everything said in each allowed channel, so Lu can follow a conversation
// rather than only his own mention exchanges. In memory; lost on restart.
export function createHistory({ limit = 20, trimTo = 10 } = {}) {
  const channels = new Map();

  return {
    record(entry) {
      const list = channels.get(entry.channelId) ?? [];
      list.push(entry);
      // Trim in a batch, not one at a time: the start of the reply prompt
      // then stays the same between trims, which lets the model server reuse
      // text it has already read.
      if (list.length > limit) list.splice(0, list.length - trimTo);
      channels.set(entry.channelId, list);
    },

    entries(channelId) {
      return [...(channels.get(channelId) ?? [])];
    },
  };
}

export function toChatTurns(entries) {
  return entries.map((e) => (e.isLu
    ? { role: 'assistant', content: e.text }
    : { role: 'user', content: `${e.name}: ${e.text}` }));
}
