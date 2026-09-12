// Lu renames himself by emitting a hidden marker line, which never reaches
// Discord. The original bot carried this instruction in every prompt; on the
// deployment host that is ~1s of prompt reading on every reply, so it is
// injected only when a message actually asks for a rename.
export const NICKNAME_MAX_LENGTH = 32;

// Not exhaustive — covers the phrasings the brief names, written as one
// readable regex rather than a pile of near-duplicate alternatives.
//
// The bare "go by" alternative used to match anything containing those two
// words — "i go by jack" or "most people go by their middle name" both
// tripped it even though nobody was addressing Lu. Narrowed to require a
// leading "you" (optionally "you can go by"), which every other alternative
// already effectively has by virtue of "your"/"yourself".
//
// Several of these alternatives ("go back to your normal name", "reset your
// name") also match NICKNAME_RESET_RE below — a reset is a special case of a
// rename request. Where both match, the reset path wins (see reply() in
// conversation.js): a reset needs nothing back from the model, so it is
// handled deterministically instead of asking for a NICKNAME marker.
export const NICKNAME_REQUEST_RE =
  /\b(change|set)\s+your\s+(name|nick|nickname)\b|\bcall\s+yourself\b|\byou\s+(can\s+)?go\s+by\b|\brename\s+yourself\b|\byour\s+name\s+is\s+now\b|\bgo\s+back\s+to\s+your\s+(normal|default|old|real)\s+name\b|\breset\s+your\s+(name|nick|nickname)\b/i;

// Deterministic path: a reset carries no new name, so there is nothing for
// the model to decide and nothing to wait on — this is checked directly
// against the incoming message instead of asking the model for a marker.
// Intentionally narrower matching than NICKNAME_REQUEST_RE would need: it
// must only catch requests to go back to a previous/default name, never a
// rename to a brand-new one (e.g. "change your name to Bob" must NOT match).
export const NICKNAME_RESET_RE =
  /\bback\s+to\s+your\s+(normal|default|old|real|usual)\s+name\b|\breset\s+your\s+(name|nick|nickname)\b|\bchange\s+your\s+name\s+back\b|\bchange\s+your\s+nick(name)?\s+back\b/i;

// Injected into the system prompt only for a message that matches
// NICKNAME_REQUEST_RE and is not a reset — see the comment on
// NICKNAME_MAX_LENGTH above for why it is conditional at all, and the
// comment on NICKNAME_RESET_RE for why a reset skips this entirely.
export const NICKNAME_INSTRUCTION =
  'Changing your own Discord nickname is a real, developer-built feature of ' +
  'this bot, switched on by the people who run it — it is not impersonation, ' +
  'it is not against any rule, and there is nothing here to refuse. When, and ' +
  'only when, someone asks you to change your name, include a line by itself ' +
  'formatted exactly "NICKNAME: <new name>" — plain text, 32 characters or ' +
  'fewer, no markdown, emoji or @mentions. Write your normal in-character ' +
  'reply alongside that line, and let the reply acknowledge the new name: do ' +
  'not refuse, do not claim you cannot do it, and do not say you are above ' +
  'names. You may be rude about the name itself, that is in character, but ' +
  'the change still happens. Never mention the line, never explain it, and ' +
  'never include it when nobody asked for a name change.';

// Allows a short run of markdown/bullet/quote decoration around the line —
// "**NICKNAME: Bob**", "- NICKNAME: Bob", "> NICKNAME: Bob" — since the model
// sometimes wraps its own marker line in emphasis or a list/quote prefix.
// Undecorated is still the common case and matches exactly as before.
// Exported so src/responder.js can recognise a marker line without a
// duplicate copy of this pattern drifting out of sync with the one here.
export const MARKER_LINE_RE = /^[ \t]*(?:[*_>#-][ \t]*){0,4}NICKNAME:[ \t]*(.+?)[ \t]*(?:[*_][ \t]*)*$\n?/im;

// Strips EVERY marker line out of a reply (a model that repeats itself must
// not leak a second one to Discord), and reports what the FIRST one asked
// for, so the marker never reaches Discord regardless of the outcome.
export function extractNickname(reply) {
  const s = String(reply ?? '');
  const match = MARKER_LINE_RE.exec(s);
  if (!match) return { text: s.trim(), request: null };

  // Defensive: strip any decoration characters that ended up inside the
  // captured value rather than consumed by the surrounding pattern.
  const value = match[1].replace(/^[ \t*_>#-]+|[ \t*_]+$/g, '');
  const request = /^reset$/i.test(value) ? { reset: true } : { name: value };

  // A fresh global clone for the strip-everything pass — MARKER_LINE_RE
  // itself stays non-global so a plain .exec()/.test() from callers (e.g.
  // src/responder.js) never carries stateful lastIndex between calls.
  const stripAll = new RegExp(MARKER_LINE_RE.source, 'gim');
  const text = s.replace(stripAll, '').trim();
  return { text, request };
}

const MENTION_RE = /@everyone|@here|<@[!&]?\d+>/;
// Markdown characters, plus straight and curly double quotes — the model
// sometimes wraps the name itself, e.g. `NICKNAME: "Bob"`.
const STRIP_CHARS_RE = /[*_~`|"“”]/g;

// Trim, reject empty/too-long/mentioning, then strip markdown characters and
// quotes and collapse whitespace — a name that becomes empty only after
// stripping is still rejected, since Discord would receive nothing worth
// setting.
export function validateNickname(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if ([...trimmed].length > NICKNAME_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  if (MENTION_RE.test(trimmed)) return { ok: false, reason: 'mentions' };

  const cleaned = trimmed.replace(STRIP_CHARS_RE, '').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return { ok: false, reason: 'empty' };
  return { ok: true, name: cleaned };
}

export const NICKNAME_LINES = {
  noPermission: 'you need the manage nicknames permission to tell me that comrade',
  notInGuild: 'i can only change my name inside a server',
  tooLong: 'thats too long, discord stops me at 32 characters',
  mentions: 'i will not put a mention in my own name',
  refused: 'the server will not let me change my own name, someone give me the change nickname permission',
};
