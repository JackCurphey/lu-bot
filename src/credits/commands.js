import { progress } from './levels.js';
import { matchKeyword } from '../attention.js';

// Isolates the "lu credits" prefix and captures whatever follows. This alone
// cannot gate the command: a rendered display name can contain spaces
// ("@COMRADE STONE" is one member), so no regex can tell a two-word name from
// a two-word sentence following it. isCreditsCommand is the real gate -- it
// checks the captured tail against the names actually mentioned on the entry.
export const CREDITS_RE = /^\s*lu[\s,:]+credits\b(.*)$/i;
export const LEADERBOARD_RE = /^\s*lu[\s,:]+leaderboard\b\s*[!.?]*\s*$/i;

// Anchored as EXPLAIN_RE is (src/decisions.js:6): only the command itself,
// optionally naming someone actually mentioned, so "lu credits are a stupid
// idea" and "lu credits @Bob what a stupid idea" both stay conversation and
// reach the model.
export function isCreditsCommand(entry) {
  const match = CREDITS_RE.exec(entry.text);
  if (!match) return false;
  const tail = match[1].trim().replace(/[!.?]+$/, '').trim();
  if (tail === '') return true;
  const named = /^@(.+)$/.exec(tail);
  if (!named) return false;
  const name = named[1].trim().toLowerCase();
  // Defaulted like every other field added to toEntry in this branch: a
  // future entry producer that omits `mentions` must not turn a credits
  // command into a caught-and-dropped TypeError (F6).
  return (entry.mentions ?? []).some((m) => m.name.toLowerCase() === name);
}

export const EMPTY_LEADERBOARD = 'the ledger is empty. nobody has earned anything yet.';

// With credits configured but switched off, a credits/leaderboard command
// would otherwise reach the model with no creditsInstruction to anchor it,
// free to invent a balance. The spec forbids fabricated user-facing values
// (F7), so this answers deterministically instead of letting it through.
export const CREDITS_DISABLED = 'the imperial ledger is switched off.';

const n = (x) => x.toLocaleString('en-GB');

// Lu included: "lu credits @Lu" asks about Lu, and answering about the asker
// instead would answer a question nobody asked.
export function resolveTarget(entry, botId) {
  const others = entry.mentions.filter((m) => m.id !== botId);
  return others[0] ?? entry.mentions[0] ?? null;
}

export function formatCredits({ name, credits }) {
  const { level, into, needed } = progress(credits);
  return `the ledger says ${name} holds ${n(credits)} imperial credits. level ${level}. ${n(needed - into)} more before level ${level + 1}.`;
}

export function formatLeaderboard(rows) {
  if (rows.length === 0) return EMPTY_LEADERBOARD;
  const lines = rows.map((r, i) => {
    // A member who earned credits before his display name was ever captured
    // is shown by id. Inventing a name would be fabricating data.
    const who = r.name || `<${r.userId}>`;
    return `${i + 1}. ${who} — ${n(r.credits)} (level ${progress(r.credits).level})`;
  });
  return ['the imperial ledger, highest first:', ...lines].join('\n');
}

export function formatLevelUp({ name, level }) {
  return `${name} reaches level ${level}. the ledger notes it.`;
}

// Words that mean somebody has raised the ledger themselves. Whole-word
// matching is borrowed from attention.js rather than reimplemented, for the
// reason recorded there: a substring match fires on "accreditation" and
// "levelling".
//
// Two words are deliberately absent. "rank" -- "rank and file" is ordinary
// speech in this channel. And the singular "credit" -- "the credit crunch",
// "credit where it is due" and "creditor" are all things said in a room that
// talks about capital, and none of them are about the ledger. Losing "what is
// my credit" to that is the cheaper mistake: a miss means the balance is
// absent, and CREDITS_STANDING_RULE already forbids inventing one.
const LEDGER_WORDS = ['credits', 'level', 'levels', 'leaderboard', 'ledger', 'xp'];

export function mentionsLedger(text) {
  return matchKeyword(LEDGER_WORDS, String(text ?? '')) !== null;
}

// Always in the prompt while credits are switched on, balance or no balance.
// It is what stops a reply that raises the ledger without one from inventing a
// figure -- so it must never carry a number itself.
export const CREDITS_STANDING_RULE = [
  'A ledger of imperial credits is kept, elsewhere and by someone else.',
  'You cannot change anyone\'s balance and you never announce a change.',
  'Never state a number from it unless a balance has been given to you in this',
  'conversation, and never invent or estimate one.',
].join(' ');

// Read-only context. Deterministic scoring in code, generative commentary from
// the model -- LU2's SOCIAL_CREDIT_AWARENESS_TEMPLATE (bot.py:182-192), which
// is what made the original bit work. Note the codebase contains both patterns
// and this one is chosen on purpose: nicknames let the model emit a marker
// code acts on, but a model that can emit a credit marker can fabricate a
// balance.
//
// Added only when someone has raised the subject or the occasional unprompted
// roll comes up (see src/conversation.js). It used to be injected into every
// reply while asking Lu not to force it in -- an instruction with no chance
// against a number sitting in his context every single time, which is why he
// mentioned it constantly.
export function creditsInstruction({ name, credits }) {
  const { level } = progress(credits);
  return [
    `${name}, who is speaking to you now, holds ${n(credits)} imperial credits and is level ${level}.`,
    'Use it if there is something worth doing with it -- mock them, congratulate them, hold it over them.',
    'Never state a number other than the one given here.',
  ].join(' ');
}
