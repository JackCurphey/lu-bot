import { levelFor } from './levels.js';

// Returns null when the message earns nothing, so the caller can treat "no
// award" as one condition rather than inspecting a zero.
//
// Commands need no rule here: `lu explain`, `lu credits` and `lu leaderboard`
// all early-return in conversation.handleMessage before awarding is reached,
// so asking for your balance structurally cannot pay you.
export function awardForMessage(store, entry, { now, random, config }) {
  const rules = config.credits;
  if (!rules?.enabled) return null;
  if (entry.isBot) return null;
  if (entry.text.trim().length < rules.minChars) return null;

  const at = now();
  const before = store.get(entry.authorId);
  // Only a paying message moves the clock, checked before any award: an
  // ineligible message that consumed the cooldown would silently swallow the
  // next message that should have paid.
  if (at - before.lastAwardAt < rules.cooldownSeconds * 1000) return null;

  const span = rules.max - rules.min + 1;
  const awarded = rules.min + Math.floor(random() * span);
  const total = store.award(entry.authorId, { credits: awarded, name: entry.name, at });

  const after = levelFor(total);
  return { awarded, total, leveledTo: after > levelFor(before.credits) ? after : null };
}
