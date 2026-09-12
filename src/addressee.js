import { stripThinking } from './responder.js';
import { withTimeout } from './timeout.js';

// Kept deliberately short: on the mini's CPU almost all of this call's cost is
// reading the prompt, not writing the one-word answer. Chosen by measurement on
// the mini over a 40-example test set.
export const ADDRESSEE_SYSTEM =
  'You read a Discord chat. Lu is a bot; humans also talk to each other. ' +
  'Judge ONLY the last message: does it speak TO Lu (a question, reply, or ' +
  'comment aimed at him), not just near him? If it addresses another named ' +
  'person, the group, or nobody, answer NO. Otherwise YES. One word.';

// Each context line's text is bounded, not just the prompt as a whole:
// reading an uncached prompt runs ~25 tok/s on the deployment host's CPU, and
// Lu's own replies run 120-200 words, so a real 6-entry history window fed
// verbatim reached 700+ tokens and always missed the judge timeout (live
// check, 2026-09-11). The "name: " prefix doesn't count against the budget.
export const ADDRESSEE_LINE_CHARS = 120;

// Codepoint-safe: a plain text.slice(0, N) counts UTF-16 code units, so it
// can cut a non-BMP character (e.g. an emoji) in half and hand the judge a
// broken surrogate. Slicing the spread array slices whole codepoints.
function truncateLine(text) {
  const codepoints = [...text];
  return codepoints.length > ADDRESSEE_LINE_CHARS
    ? `${codepoints.slice(0, ADDRESSEE_LINE_CHARS).join('')}…`
    : text;
}

export function buildAddresseeMessages({ entries }) {
  // ADDRESSEE_SYSTEM tells the judge to rule on ONLY the last entry, and
  // addressing cues ("...right, Lu?") often sit at the very end of a
  // sentence. Truncating that entry could strip the cue the judge needs and
  // turn a real YES into a false NO, so the last entry is exempt: only the
  // context entries (everything before it) are bounded. The prompt-size
  // guarantee still holds in practice -- up to 5 bounded context lines plus
  // one full final message.
  const lastIndex = entries.length - 1;
  const lines = entries
    .map((e, i) => `${e.isLu ? 'Lu' : e.name}: ${i === lastIndex ? e.text : truncateLine(e.text)}`)
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
