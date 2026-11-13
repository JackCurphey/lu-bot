import { stripThinking } from './responder.js';
import { withTimeout } from './timeout.js';

// Retuned 2026-11-13 for Bonsai 2 27B. The earlier wording ("...the group, or
// nobody, answer NO") made Bonsai read every follow-up that didn't repeat
// Lu's name as aimed at nobody: 11/16 and 4/8 on the made-up examples in
// scripts/addressee-examples.json, every miss a follow-up to Lu. Re-measure
// with scripts/eval-addressee.js after any change to this wording.
export const ADDRESSEE_SYSTEM =
  'You read a Discord chat. Lu is a bot; humans also talk to each other. ' +
  'Judge ONLY the last message: does it speak TO Lu? A message that carries ' +
  'on a conversation with Lu counts as speaking to him even without his name: ' +
  'answering what Lu just said, asking him a follow-up, reacting to his line, ' +
  'or pushing back on it. If the last message speaks to another named person, ' +
  'the whole group, or starts an unrelated topic, answer NO. Otherwise YES. ' +
  'One word.';

// Each context line's text is bounded, not just the prompt as a whole:
// reading an uncached prompt runs ~25 tok/s on the deployment host's CPU, and
// Lu's own replies run 120-200 words, so a real 6-entry history window fed
// verbatim reached 700+ tokens and always missed the judge timeout (live
// check, 2026-09-11). The "name: " prefix doesn't count against the budget.
export const ADDRESSEE_LINE_CHARS = 120;

// The last entry (the message under judgment) is exempt from head-truncation
// -- see buildAddresseeMessages -- but it is not left unbounded either.
// Discord allows messages up to 2000 chars (~500 tokens); at ~25 tok/s
// uncached read speed on the deployment host, a maximal message alone is
// ~20s of reading against the 30s judge timeout, with no headroom for
// queueing behind another job or for the model's own generation. That is the
// same class of failure fix round 1 addressed for context lines. So the last
// entry is capped too, but by keeping its TAIL rather than its head: context
// lines are read for gist, so the head is what matters; the judged line is
// read for who it is aimed at, and that addressing cue ("...right, Lu?")
// sits at the end.
export const ADDRESSEE_LAST_LINE_CHARS = 600;

// Codepoint-safe: a plain text.slice(0, N) counts UTF-16 code units, so it
// can cut a non-BMP character (e.g. an emoji) in half and hand the judge a
// broken surrogate. Slicing the spread array slices whole codepoints.
function truncateLine(text) {
  const codepoints = [...text];
  return codepoints.length > ADDRESSEE_LINE_CHARS
    ? `${codepoints.slice(0, ADDRESSEE_LINE_CHARS).join('')}…`
    : text;
}

// Codepoint-safe tail truncation for the last (judged) entry -- see
// ADDRESSEE_LAST_LINE_CHARS for why this keeps the end instead of the start.
function truncateLastLine(text) {
  const codepoints = [...text];
  return codepoints.length > ADDRESSEE_LAST_LINE_CHARS
    ? `…${codepoints.slice(-ADDRESSEE_LAST_LINE_CHARS).join('')}`
    : text;
}

export function buildAddresseeMessages({ entries }) {
  // ADDRESSEE_SYSTEM tells the judge to rule on ONLY the last entry, and
  // addressing cues ("...right, Lu?") often sit at the very end of a
  // sentence, so head-truncating that entry like the context lines could
  // strip the cue the judge needs and turn a real YES into a false NO. The
  // last entry gets its own bound instead: truncateLastLine keeps its TAIL
  // (see ADDRESSEE_LAST_LINE_CHARS), while context entries (everything
  // before it) keep the existing head-truncation.
  const lastIndex = entries.length - 1;
  const lines = entries
    .map((e, i) => `${e.isLu ? 'Lu' : e.name}: ${i === lastIndex ? truncateLastLine(e.text) : truncateLine(e.text)}`)
    .join('\n');
  return [
    { role: 'system', content: ADDRESSEE_SYSTEM },
    { role: 'user', content: lines },
  ];
}

export function parseAddresseeAnswer(raw) {
  const match = /^\W*(yes|no)\b/i.exec(stripThinking(raw));
  if (!match) return { yes: false, reason: 'unclear answer' };
  return { yes: match[1].toLowerCase() === 'yes', reason: '' };
}

// Fails toward silence, like the corpus judge: any doubt is NO.
export async function isAddressedToLu({
  entries, llm, config, available = true, setTimeoutImpl, clearTimeoutImpl,
}) {
  const model = config.llm.addresseeModel;
  if (!available) return { yes: false, reason: `judge model ${model} is not installed` };

  const seconds = config.trigger.addresseeTimeoutSeconds;
  try {
    const raw = await withTimeout(
      (signal) => llm.chat({
        model,
        messages: buildAddresseeMessages({ entries }),
        temperature: 0,
        maxTokens: 3,
        signal,
      }),
      seconds * 1000,
      { setTimeoutImpl, clearTimeoutImpl },
    );
    return parseAddresseeAnswer(raw);
  } catch (err) {
    return {
      yes: false,
      reason: err.name === 'TimeoutError' ? `judge timed out after ${seconds}s` : `judge error: ${err.message}`,
    };
  }
}

export function hasModel(ids, name) {
  return ids.includes(name) || (!name.includes(':') && ids.includes(`${name}:latest`));
}
