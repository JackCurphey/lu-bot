// Someone tells Lu what they want built, and Lu writes it down. The file is
// append-only and read outside the bot (by a developer on the host), never by
// Lu himself — see docs/superpowers/specs/2026-09-18-suggestions-design.md.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Lu has to be named, and a suggestion word has to follow him almost
// immediately. Both halves matter: without the name, "we should suggest a name
// for the channel" files a suggestion; without the adjacency, "lu what do you
// think of daves idea" does. A mention arrives in the text as "@Lu"
// (src/discord.js), so the @ is optional rather than required.
const SUGGESTION_RE =
  /\b@?lu\b[\s,]*(?:suggest(?:ion)?|idea|feature\s+request)\b[\s:,.\-–—]*(?:that\s+)?([\s\S]*)$/i;

// Returns null when the message is not a suggestion, otherwise { text }. An
// empty text is a real outcome, not a non-match: the person named Lu and said
// "suggest" but gave nothing to record, and Lu answers rather than ignoring it.
export function parseSuggestion(text) {
  const match = SUGGESTION_RE.exec(String(text ?? ''));
  return match ? { text: match[1].trim() } : null;
}

// Every field comes from the Discord message itself. The jump link is built
// from the three ids, so it only exists where all three do -- a DM has no
// guild and therefore no link, rather than a link that goes nowhere.
export function formatEntry({
  text, authorId, authorName, guildId, channelId, messageId, at = Date.now(),
}) {
  return {
    at: new Date(at).toISOString(),
    text,
    authorId,
    authorName,
    guildId: guildId ?? null,
    channelId,
    messageId,
    link: guildId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null,
  };
}

// One JSON object per line, appended. A suggestion's own newlines survive
// inside the JSON string, so a line of the file is always exactly one
// suggestion. Append-only means a bad write damages at most its own line
// rather than everything recorded before it. Failures propagate: the caller
// must not tell anyone their idea was written down when it was not.
export async function appendSuggestion({ path, entry }) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

export const SUGGESTION_LINES = {
  noted: () => 'noted. ill put that in front of the boss',
  empty: () => 'suggest what? say it after "lu suggest"',
  failed: () => 'i went to write that down and my pen died. tell mark directly',
};
