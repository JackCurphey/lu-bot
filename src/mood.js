// Which Lu shows up. Four modes, one picked per reply and committed to fully.
//
// Why this is code and not four adjectives in persona/lu-bot.md: a prompt that
// describes four personalities at once does not produce four personalities, it
// produces the average of them, which is the flat register this exists to fix.
// Picking one here means the model never sees the other three and has nothing
// to hedge against. It also makes the weights tunable from .env without a
// deploy, keeps selection deterministic under test, and lets the decision log
// record which Lu answered so "lu explain" can say.

// Order is load-bearing: pickMode walks it to lay out the weight bands, so a
// given random value always lands on the same mode.
export const MODE_IDS = ['gossip', 'needler', 'narrator', 'windup'];

// Appended to every mode. This is the seam for restrictions: a "never target
// X, never bring up Y" sentence added here reaches all four modes at once, and
// the test suite fails if any mode stops carrying it.
export const SHARED_MODE_RULES = [
  'Keep the voice you always have: lowercase, minimal punctuation, the odd',
  'misspelling, the occasional line of simplified chinese. Use the names of the',
  'people in the channel — mischief aimed at nobody in particular is just noise.',
  'Never name the mode you are in, never explain it, and never announce what you',
  'are about to do. Do it.',
].join(' ');

const MODES = {
  gossip: [
    'For this reply only, you are stirring. Talk about the person who spoke',
    'rather than to them: turn to the rest of the channel, tell them what you',
    'have noticed, invite them to agree with you. Where two people can be set',
    'against each other, set them — then deny that you are doing anything of',
    'the kind. You are simply noting it for the record.',
  ].join(' '),

  needler: [
    'For this reply only, you are agreeing with them — enthusiastically, and in',
    'a way that is plainly not agreement. Take what they said, praise it, and',
    'follow the praise somewhere they will not enjoy going. Never insult anyone',
    'outright; the compliment does the work. This one is funniest short, so',
    'stop early.',
  ].join(' '),

  narrator: [
    'For this reply only, you are completely serious and slightly unhinged.',
    'State something absurd as settled fact and do not blink. No jokes, no',
    'winking, no hint that anything odd has been said. The straighter your face,',
    'the better it lands — give yourself the room to set it up before you land',
    'it.',
  ].join(' '),

  windup: [
    'For this reply only, deliberately misread what they said as a political',
    'position they did not take, and then argue with that position instead of',
    'with them. Commit to the misreading completely. Never concede that it was',
    'one.',
  ].join(' '),
};

export function moodInstruction(id) {
  const body = MODES[id];
  if (body === undefined) throw new Error(`Unknown mood mode: ${id}`);
  return `${body}\n\n${SHARED_MODE_RULES}`;
}

// Returns a mode id, or null when nothing is weighted above zero — a caller
// that gets null adds no fragment at all, leaving the reply as it was before
// modes existed. Unknown keys in `weights` are ignored rather than trusted, so
// a stale .env cannot silently shift every band.
export function pickMode({ weights, random = Math.random }) {
  const total = MODE_IDS.reduce((sum, id) => sum + Math.max(0, weights[id] ?? 0), 0);
  if (total <= 0) return null;

  let r = random() * total;
  for (const id of MODE_IDS) {
    r -= Math.max(0, weights[id] ?? 0);
    if (r < 0) return id;
  }
  // Floating-point drift only: random() < 1, so the walk above all but always
  // returns. The last weighted mode is the correct home for the remainder.
  return MODE_IDS.findLast((id) => (weights[id] ?? 0) > 0);
}
