import { verifyQuotes } from './quotes.js';

export function buildMessages({ persona, chunks, history, message }) {
  const corpusBlock = chunks.length > 0
    ? [
        'Passages available to you. You may quote from these and only these:',
        ...chunks.map((c, i) => `[${i + 1}] From "${c.source.title}" by ${c.source.author}:\n${c.text}`),
      ].join('\n\n')
    : 'No passages were retrieved for this message. Reply conversationally without quoting.';

  return [
    { role: 'system', content: `${persona}\n\n---\n\n${corpusBlock}` },
    ...history,
    { role: 'user', content: message },
  ];
}

export async function respond({ message, chunks, history, persona, llm, config }) {
  const messages = buildMessages({ persona, chunks, history, message });
  const reply = await llm.chat({ model: config.llm.chatModel, messages });

  const verdict = verifyQuotes(reply, chunks, { maxQuoteChars: config.trigger.maxQuoteChars });
  if (!verdict.ok) {
    const reasons = [
      ...verdict.fabricated.map((q) => `unverified: ${q}`),
      ...verdict.overlong.map((q) => `too long (${q.length} chars): ${q.slice(0, 60)}...`),
      ...verdict.unverifiable.map((reason) => `unverifiable: ${reason}`),
    ];
    console.warn(`Dropped reply — ${reasons.join(' | ')}`);
    return null;
  }

  return reply;
}
