import { progress } from './levels.js';

// Anchored as EXPLAIN_RE is (src/decisions.js:6): only the command itself,
// optionally naming someone, so "lu credits are a stupid idea" stays
// conversation and reaches the model. The trailing "@..." is loose because a
// rendered display name can contain spaces -- "@COMRADE STONE" is one member.
export const CREDITS_RE = /^\s*lu[\s,:]+credits\b\s*(?:@.*?)?\s*[!.?]*\s*$/i;
export const LEADERBOARD_RE = /^\s*lu[\s,:]+leaderboard\b\s*[!.?]*\s*$/i;

export const EMPTY_LEADERBOARD = 'the ledger is empty. nobody has earned anything yet.';

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

// Read-only context. Deterministic scoring in code, generative commentary from
// the model -- LU2's SOCIAL_CREDIT_AWARENESS_TEMPLATE (bot.py:182-192), which
// is what made the original bit work. Note the codebase contains both patterns
// and this one is chosen on purpose: nicknames let the model emit a marker
// code acts on, but a model that can emit a credit marker can fabricate a
// balance.
export function creditsInstruction({ name, credits }) {
  const { level } = progress(credits);
  return [
    `You keep a ledger of imperial credits. ${name}, who is speaking to you now, holds ${n(credits)} imperial credits and is level ${level}.`,
    'You may reference it, mock them over it, or praise them for it wherever that fits naturally. Do not force it into every reply.',
    'You cannot change anyone\'s credits and you never announce a change. The ledger is kept elsewhere; you only read it. Never state a number other than the one given above.',
  ].join(' ');
}
