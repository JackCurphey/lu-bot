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

// Each earlier line in the reply prompt keeps at most this many characters.
// On the PC each conversation slot holds 12,288 tokens (-c 24576 over two
// slots). Uncapped, 60 lines at Discord's 2,000-character maximum would
// overflow it; at 500 the measured worst case is 7,887 tokens, persona and a
// full-length current message included (2026-11-13). The message being
// replied to is not part of this history, so it stays whole.
export const HISTORY_LINE_CHARS = 500;

// Codepoint-safe, like src/addressee.js: slicing UTF-16 units could cut an
// emoji in half.
function capLine(text) {
  const codepoints = [...text];
  return codepoints.length > HISTORY_LINE_CHARS
    ? `${codepoints.slice(0, HISTORY_LINE_CHARS).join('')}…`
    : text;
}

export function toChatTurns(entries) {
  return entries.map((e) => (e.isLu
    ? { role: 'assistant', content: capLine(e.text) }
    : { role: 'user', content: `${e.name}: ${capLine(e.text)}` }));
}
