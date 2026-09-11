// Why Lu did or did not answer each message, so "lu explain" can say — and so
// a model error, a rejected quotation and a timeout stop looking identical.

// Matched as old Lu did: only the command itself, optionally with an id and
// trailing punctuation, so "lu explain why..." is conversation, not a command.
export const EXPLAIN_RE = /^\s*lu[\s,:]+explain\b\s*(\d+)?\s*[!.?]*\s*$/i;

export const NOT_FOUND =
  'i dont have a record of that one, either nothing happened here since i restarted or it aged out';

const SENT_PREVIEW = 200;

export function createDecisionLog({ perChannel = 50 } = {}) {
  const channels = new Map();

  return {
    record(channelId, rec) {
      const list = channels.get(channelId) ?? [];
      list.push(rec);
      if (list.length > perChannel) list.splice(0, list.length - perChannel);
      channels.set(channelId, list);
      return rec;
    },

    find(channelId, messageId) {
      const list = channels.get(channelId) ?? [];
      if (messageId == null) return list.at(-1) ?? null;
      return list.findLast((r) => r.messageId === messageId) ?? null;
    },
  };
}

export function formatDecision(rec) {
  const verb = rec.sent != null ? 'I replied to' : 'I did not reply to';
  const lines = [
    `${verb} ${rec.authorName}'s message (id \`${rec.messageId}\`):`,
    ...rec.reasons.map((r) => `- ${r}`),
  ];
  if (rec.sent != null) {
    const preview = rec.sent.length > SENT_PREVIEW ? `${rec.sent.slice(0, SENT_PREVIEW)}...` : rec.sent;
    lines.push(`- what i sent: '${preview}'`);
  }
  return lines.join('\n');
}
