// Lu renames other members when someone with Manage Nicknames asks. Renaming
// Lu himself ("change your name") stays in src/nickname.js; this module only
// recognises requests aimed at a member, and matches typed names to members.
// See docs/superpowers/specs/2026-09-17-rename-others-design.md.
import { LU_NAME } from './discord.js';

// A mention is rendered into the text as "@displayName" (src/discord.js), which
// can contain spaces. Each is swapped for an opaque token before matching, so
// the patterns below only ever see one token per mention.
const OPEN = '';
const CLOSE = '';
const TARGET = `(${OPEN}\\d+${CLOSE}|[\\p{L}\\p{N}_.-]+)`;
const NAME_WORD = '(?:name|nick|nickname)';
const END = '[\\s.!?]*$';

// Words that sit where a target would but are not one. "your" and "yourself"
// belong to src/nickname.js; the rest would turn ordinary chat ("rename this
// file", "change the name of the channel", "give it a name") into a request.
const NOT_A_TARGET = new Set([
  'your', 'yourself', 'you', 'him', 'her', 'hers', 'his', 'them', 'their', 'it',
  'its', 'this', 'that', 'the', 'a', 'an', 'us', 'our', 'everyone', 'everybody',
  'someone', 'somebody', 'something', 'all',
]);

const PATTERNS = [
  { re: new RegExp(`\\brename\\s+${TARGET}(?:\\s+(?:to|as)\\s+([^\\n]+?))?${END}`, 'imu'), name: 2 },
  { re: new RegExp(`\\b(?:change|set)\\s+${TARGET}(?:'s|’s|')?\\s+${NAME_WORD}\\s+back${END}`, 'imu'), reset: true },
  { re: new RegExp(`\\b(?:change|set)\\s+${TARGET}(?:'s|’s|')?\\s+${NAME_WORD}(?:\\s+to\\s+([^\\n]+?))?${END}`, 'imu'), name: 2 },
  { re: new RegExp(`\\breset\\s+${TARGET}(?:'s|’s|')?\\s+${NAME_WORD}${END}`, 'imu'), reset: true },
  { re: new RegExp(`\\bgive\\s+${TARGET}\\s+an?\\s+(?:new\\s+)?${NAME_WORD}${END}`, 'imu') },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns null when the text is not a request to rename a member, otherwise
// { target, name, reset }. target is { id, name } when the member is known
// from the text itself (a mention, "my"/"me", or Lu), or { typed } when only a
// typed name was given and the caller has to find who it means. name is null
// when Lu is to choose one, or when resetting.
export function parseMemberRename(text, { mentions = [], authorId, authorName, luId }) {
  const known = [
    ...mentions.filter((m) => m.id !== luId),
    { id: luId, name: LU_NAME },
  ].sort((a, b) => b.name.length - a.name.length);

  let tokenised = String(text ?? '');
  known.forEach((m, i) => {
    tokenised = tokenised.replace(new RegExp(`@${escapeRe(m.name)}`, 'giu'), `${OPEN}${i}${CLOSE}`);
  });

  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(tokenised);
    if (!match) continue;
    const raw = match[1];
    if (NOT_A_TARGET.has(raw.toLowerCase())) continue;

    let target;
    if (raw.startsWith(OPEN)) {
      const m = known[Number(raw.slice(1, -1))];
      target = { id: m.id, name: m.name };
    } else if (/^(my|me)$/i.test(raw)) {
      target = { id: authorId, name: authorName };
    } else if (raw.toLowerCase() === LU_NAME.toLowerCase()) {
      target = { id: luId, name: LU_NAME };
    } else {
      target = { typed: raw };
    }

    const name = pattern.name ? (match[pattern.name]?.trim() || null) : null;
    return { target, name, reset: pattern.reset === true };
  }
  return null;
}

// Exact, case-insensitive. A prefix is not a match: "dav" renaming whichever
// Dave Discord returns first is exactly the wrong-person rename the user was
// promised would not happen.
export function matchesMemberName(member, typed) {
  const want = String(typed).toLowerCase();
  return [member.displayName, member.nickname, member.username, member.globalName]
    .some((n) => typeof n === 'string' && n.toLowerCase() === want);
}

export const RENAME_LINES = {
  targetUnknown: (who) => `who is ${who}, i cannot find them. @mention them`,
  targetAmbiguous: (who) => `there is more than one ${who} here, @mention the one you mean`,
  outranked: (who) => `${who} outranks me, discord will not let me touch their name`,
  refused: (who) => `the server will not let me rename ${who}, i need the manage nicknames permission`,
  mentions: () => 'i will not put a mention in anyones name',
  tooLong: () => 'thats too long, discord stops names at 32 characters',
};

// Told to the model after a named rename or reset has already been applied, so
// his reply reacts to what actually happened rather than promising it.
export function memberRenamedInstruction({ asker, who, name }) {
  const done = name === null
    ? `${asker} had you reset ${who}'s Discord nickname back to their own name, and it is done.`
    : `${asker} had you rename ${who} on Discord, and it is done: they are now called "${name}".`;
  return `${done} React to that in character. Do not include a NICKNAME line.`;
}

// Lu picks the name. Reuses the NICKNAME marker src/nickname.js already strips
// and src/responder.js already protects from the length trim; the conversation
// sends the name to the member instead of to Lu.
export function pickNameInstruction({ asker, who }) {
  return (
    'Renaming members is a real, developer-built feature of this bot, switched ' +
    'on by the people who run it, and the person asking is allowed to ask. ' +
    `${asker} wants you to give ${who} a new Discord nickname. Choose one in ` +
    'character and include a line by itself formatted exactly "NICKNAME: <new ' +
    `name>" — that name is for ${who}, not for you. Plain text, 32 characters ` +
    'or fewer, no markdown, emoji or @mentions. Write your normal in-character ' +
    'reply alongside that line. Never mention the line and never explain it.'
  );
}
