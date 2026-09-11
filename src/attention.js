// Decides whether Lu answers a message, without calling any model. Most
// messages are settled here in well under a millisecond; only unclear ones
// inside a live conversation go on to the (expensive) judge.

const WORD = '[\\p{L}\\p{N}_]';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole words only: old Lu's substring match fired on "lunch", "blue", "value".
export function matchKeyword(keywords, text) {
  for (const keyword of keywords) {
    const body = escapeRegex(keyword).replace(/\s+/g, '\\s+');
    if (new RegExp(`(?<!${WORD})${body}(?!${WORD})`, 'iu').test(text)) return keyword;
  }
  return null;
}

function result(outcome, trigger, reason) {
  return { outcome, trigger, reasons: [reason] };
}

function inConversation(history, now, t) {
  return history
    .slice(-t.windowMessages)
    .some((e) => e.isLu && now - e.at < t.windowMinutes * 60_000);
}

export function decide({ entry, history, state, now, config, random = Math.random }) {
  const t = config.trigger;

  if (entry.isBot) return result('ignore', null, 'the author is a bot, and i never answer bots');
  if (entry.mentionsLu) return result('reply', 'mention', 'i was @mentioned');
  if (entry.repliesToLu) return result('reply', 'reply-to-lu', 'it was a reply to one of my messages');

  const keyword = matchKeyword(t.keywords, entry.text);
  if (keyword) return result('reply', 'keyword', `it contains "${keyword}"`);

  if (entry.repliesToOther) return result('ignore', null, 'it was a reply to someone else');
  if (entry.mentionsOthers) return result('ignore', null, 'it @mentions someone else');

  if (!t.enabled) {
    return result('ignore', null, 'unprompted replies are switched off (TRIGGER_ENABLED=false)');
  }

  if (inConversation(history, now, t)) {
    return result(
      'ask-judge', 'window',
      `i spoke within the last ${t.windowMessages} messages and ${t.windowMinutes} minutes`,
    );
  }

  // The cooldown limits random chime-ins only. Anything aimed at Lu is
  // handled above and is never blocked by it.
  if (state.lastChimeAt != null && now - state.lastChimeAt < t.cooldownSeconds * 1000) {
    return result('ignore', null, 'i was not in the conversation, and random chime-ins are on cooldown');
  }
  if (random() < t.randomReplyChance) {
    return result('reply', 'chime', `random chime-in (${t.randomReplyChance * 100}% chance)`);
  }
  return result('ignore', null, 'i was not in the conversation, and the random chime-in did not fire');
}
