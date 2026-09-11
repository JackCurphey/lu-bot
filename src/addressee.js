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

export function buildAddresseeMessages({ entries }) {
  const lines = entries.map((e) => `${e.isLu ? 'Lu' : e.name}: ${e.text}`).join('\n');
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
