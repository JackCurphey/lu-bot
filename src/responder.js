import { verifyQuotes, checkQuoteLength } from './quotes.js';

// The chat model emits reasoning tokens on every reply, and none of
// chat_template_kwargs, /no_think or reasoning_effort disables it through LM
// Studio's MLX engine — all three were tested. When a <think> block lands in
// `content` it would otherwise be posted to Discord verbatim and stored into
// conversation history, where it feeds back into every subsequent turn.
//
// Stripped before verification as well as before posting: reasoning routinely
// contains the model talking itself through candidate quotations, which the
// verifier would otherwise treat as citations.
export function stripThinking(text) {
  return String(text ?? '')
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    // A generation that hit the token limit mid-reasoning never closes the
    // tag; everything from the opener on is reasoning, not reply.
    .replace(/<think\b[^>]*>[\s\S]*$/i, '')
    .trim();
}

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

export function trimCutOff(text) {
  const s = String(text ?? '');
  const boundary = Math.max(
    s.lastIndexOf('. '), s.lastIndexOf('! '), s.lastIndexOf('? '), s.lastIndexOf('\n'),
    s.lastIndexOf('。'), s.lastIndexOf('！'), s.lastIndexOf('？'),
  );
  // Only honour a boundary in the second half; otherwise a reply that opens
  // with one short sentence would lose nearly everything.
  if (boundary >= Math.floor(s.length / 2)) return s.slice(0, boundary + 1).trimEnd();
  const lastSpace = s.lastIndexOf(' ');
  return (lastSpace > 0 ? s.slice(0, lastSpace) : s).trimEnd();
}

export async function respondWithReason({ message, chunks, history, persona, llm, config, signal }) {
  const messages = buildMessages({ persona, chunks, history, message });
  const { content, finishReason } = await llm.chatWithFinish({
    model: config.llm.chatModel,
    messages,
    maxTokens: config.reply.maxTokens,
    signal,
  });
  const stripped = stripThinking(content);
  // Cut off at the cap: drop the half-finished tail so he never stops
  // mid-sentence. Lu writes with minimal punctuation by design, so a reply
  // with no sentence end at all keeps its last whole word instead.
  const reply = finishReason === 'length' ? trimCutOff(stripped) : stripped;
  if (reply === '') {
    return { ok: false, reason: 'empty reply after stripping reasoning' };
  }

  // No passages were supplied, so nothing was offered to cite and there is no
  // citation to get wrong. Only the length cap still applies.
  const verdict = chunks.length === 0
    ? checkQuoteLength(reply, { maxQuoteChars: config.trigger.maxQuoteChars })
    : verifyQuotes(reply, chunks, { maxQuoteChars: config.trigger.maxQuoteChars });
  if (!verdict.ok) {
    const reasons = [
      ...verdict.fabricated.map((q) => `unverified: ${q}`),
      ...verdict.overlong.map((q) => `too long (${q.length} chars): ${q.slice(0, 60)}...`),
      ...verdict.unverifiable.map((reason) => `unverifiable: ${reason}`),
    ];
    return { ok: false, reason: `quote check failed: ${reasons.join(' | ')}` };
  }

  return { ok: true, reply };
}

export async function respond(args) {
  const result = await respondWithReason(args);
  if (!result.ok) {
    console.warn(`Dropped reply — ${result.reason}`);
    return null;
  }
  return result.reply;
}
