// "lu stop" / "lu you can talk": telling Lu to be quiet in a channel for a
// while. Only a whole message that is the command counts, and only when it is
// aimed at him (his name at the start or end, an @mention, or a reply to him),
// so the failure mode is "didn't stop", never "stopped by accident".
const STOP_RE = /^(?:stop(?: talking)?|shut up|be quiet|quiet|hush|shh+)$/;
const RESUME_RE = /^(?:you can (?:talk|speak)(?: again)?(?: now)?|(?:talk|speak) again|come back|unmute)$/;

// Punctuation becomes space, so "Lu, shut up!" reads as "lu shut up".
const normalise = (text) => String(text ?? '').toLowerCase().replace(/[!.?,:;]+/g, ' ').replace(/\s+/g, ' ').trim();

export function parseQuietCommand(entry, { keywords = ['lu'] } = {}) {
  let t = normalise(entry.text);
  let addressed = Boolean(entry.mentionsLu || entry.repliesToLu);
  // An @mention of Lu is rendered as "@Lu" in the entry's text.
  const names = ['@lu', ...keywords.map((k) => k.toLowerCase())];
  for (const n of names) {
    if (t.startsWith(`${n} `)) { t = t.slice(n.length + 1); addressed = true; break; }
  }
  for (const n of names) {
    if (t.endsWith(` ${n}`)) { t = t.slice(0, -(n.length + 1)); addressed = true; break; }
  }
  t = t.replace(/^please /, '').replace(/ please$/, '').trim();
  if (!addressed) return null;
  if (STOP_RE.test(t)) return 'stop';
  if (RESUME_RE.test(t)) return 'resume';
  return null;
}

// Fixed lines, never written by the model: the person asking needs to know
// it worked, and nothing else.
export const QUIET_LINES = {
  stopped: (minutes) => `fine. i'll be quiet for ${minutes} minute${minutes === 1 ? '' : 's'}.`,
  resumed: () => "i'm back.",
};
