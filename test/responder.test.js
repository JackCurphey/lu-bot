import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, respond, respondWithReason, stripThinking } from '../src/responder.js';

const persona = 'You are Lu Bot.';
const chunks = [{ text: 'Political power grows out of the barrel of a gun.', source: { title: 'T', author: 'A' } }];
const config = { trigger: { maxQuoteChars: 400 }, llm: { chatModel: 'chat' } };

const llmReturning = (content) => ({ async chat() { return content; } });

test('system message carries the persona', () => {
  const messages = buildMessages({ persona, chunks: [], history: [], message: 'hi' });
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.includes('You are Lu Bot.'));
  assert.deepEqual(messages.at(-1), { role: 'user', content: 'hi' });
});

test('retrieved chunks appear in the system message with attribution', () => {
  const messages = buildMessages({ persona, chunks, history: [], message: 'hi' });
  assert.ok(messages[0].content.includes('barrel of a gun'));
  assert.ok(messages[0].content.includes('T'));
});

test('with no chunks the system message says the corpus is unavailable', () => {
  const messages = buildMessages({ persona, chunks: [], history: [], message: 'hi' });
  assert.match(messages[0].content, /no passages|without quoting/i);
});

test('history is included between system and user messages', () => {
  const history = [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }];
  const messages = buildMessages({ persona, chunks: [], history, message: 'now' });
  assert.equal(messages.length, 4);
  assert.equal(messages[1].content, 'earlier');
});

test('a reply with a genuine quote is returned unchanged', async () => {
  const text = 'As it says, "Political power grows out of the barrel of a gun."';
  const out = await respond({
    message: 'what did he say?', chunks, history: [], persona,
    llm: llmReturning(text), config,
  });
  assert.equal(out, text);
});

test('a reply containing a fabricated quote is rejected', async () => {
  const out = await respond({
    message: 'what did he say?', chunks, history: [], persona,
    llm: llmReturning('He wrote, "This sentence appears in no supplied chunk at all."'),
    config,
  });
  assert.equal(out, null);
});

test('a reply whose quote exceeds maxQuoteChars is rejected', async () => {
  const longChunk = [{
    text: `Preamble. ${'word '.repeat(200)}End.`,
    source: { title: 'T', author: 'A' },
  }];
  const quoted = `"${'word '.repeat(200).trim()}"`;
  const out = await respond({
    message: 'quote at length', chunks: longChunk, history: [], persona,
    llm: llmReturning(`He wrote, ${quoted}`),
    config: { ...config, trigger: { maxQuoteChars: 100 } },
  });
  assert.equal(out, null);
});

test('a reply with an unbalanced quote delimiter is rejected as unverifiable', async () => {
  const out = await respond({
    message: 'what did he say?', chunks, history: [], persona,
    llm: llmReturning('He wrote, "Political power grows out of the barrel of a gun.'),
    config,
  });
  assert.equal(out, null);
});

test('a conversational reply with no quotes passes even with no chunks', async () => {
  const out = await respond({
    message: 'hello', chunks: [], history: [], persona,
    llm: llmReturning('Good morning, comrade.'), config,
  });
  assert.equal(out, 'Good morning, comrade.');
});

// --- Whole-branch review, finding D: an empty corpus muted conversation -----
//
// The bot ships with no texts; that is the documented default state. With
// chunks: [] the responder still ran fabrication-matching against an empty
// haystack, so quoting the user's own words back — conversation, not
// citation — was dropped and the user got silence after mentioning the bot.
// Nothing was offered to cite, so there is no citation risk to check for.

test('D: quoting the user back is not a citation when no chunks were supplied', async () => {
  const text = 'You said "the state will wither away" but that is not what he meant.';
  const out = await respond({
    message: 'the state', chunks: [], history: [], persona,
    llm: llmReturning(text), config,
  });
  assert.equal(out, text);
});

test('D: a Chinese aside with no chunks supplied is not dropped', async () => {
  const text = '「为人民服务，不是一句空话」— that is the whole of it.';
  const out = await respond({
    message: '为人民服务', chunks: [], history: [], persona,
    llm: llmReturning(text), config,
  });
  assert.equal(out, text);
});

test('D: a stray straight quote with no chunks supplied is not dropped', async () => {
  const text = 'The bar was 6" off the floor and he still pulled it.';
  const out = await respond({
    message: 'the bar', chunks: [], history: [], persona,
    llm: llmReturning(text), config,
  });
  assert.equal(out, text);
});

test('D: with chunks supplied a fabricated quote is still dropped', async () => {
  const out = await respond({
    message: 'what did he say?', chunks, history: [], persona,
    llm: llmReturning('He wrote, "This sentence appears in no supplied chunk at all."'),
    config,
  });
  assert.equal(out, null);
});

test('D: the length cap still applies with no chunks supplied', async () => {
  const out = await respond({
    message: 'go long', chunks: [], history: [], persona,
    llm: llmReturning(`He wrote, "${'word '.repeat(200).trim()}"`),
    config: { ...config, trigger: { maxQuoteChars: 100 } },
  });
  assert.equal(out, null);
});

// --- Whole-branch review, finding G: <think> blocks were never stripped -----

test('G: a think block is removed from the reply', () => {
  assert.equal(
    stripThinking('<think>weighing it up</think>Power grows from the barrel.'),
    'Power grows from the barrel.',
  );
});

test('G: an unclosed think block leaves only what preceded it', () => {
  assert.equal(stripThinking('Before it. <think>never closed'), 'Before it.');
  assert.equal(stripThinking('<think>never closed at all'), '');
});

test('G: a reply with no think block is unchanged', () => {
  assert.equal(stripThinking('Power grows from the barrel.'), 'Power grows from the barrel.');
});

test('G: reasoning is stripped before verification, not posted', async () => {
  const out = await respond({
    message: 'what did he say?', chunks, history: [], persona,
    llm: llmReturning(
      '<think>I could invent "The revolution begins in the heart of the worker" here.</think>' +
      'As it says, "Political power grows out of the barrel of a gun."',
    ),
    config,
  });
  assert.equal(out, 'As it says, "Political power grows out of the barrel of a gun."');
});

test('G: a reply that is nothing but reasoning yields no message', async () => {
  const out = await respond({
    message: 'hello', chunks: [], history: [], persona,
    llm: llmReturning('<think>still thinking</think>   '), config,
  });
  assert.equal(out, null);
});

// --- Finding E: an undelimited attribution reached the channel with no corpus
//
// The defect was invisible at the verifier level alone — verifyQuotes was
// always correct. It lived in which verifier `respond` chose when chunks was
// empty, which is the bot's documented shipping default and also what chunks
// looks like every time the relevance judge declines a loaded corpus. So
// these run against `respond`, the path that actually executes.

const NEUTRAL_CHUNKS = [
  { text: 'The quick brown fox jumps over the lazy dog.', source: { title: 'T', author: 'A' } },
];
const INVENTED = 'A sentence that appears in no source whatsoever.';

const respondWith = (text, withChunks = []) => respond({
  message: 'anything', chunks: withChunks, history: [], persona,
  llm: llmReturning(text), config,
});

test('E: an attribution cue plus colon plus invented sentence is dropped with no corpus', async () => {
  assert.equal(await respondWith(`As Ada Placeholder wrote in Some Work: ${INVENTED}`), null);
});

test('E: a blockquote line carrying an invented sentence is dropped with no corpus', async () => {
  assert.equal(await respondWith(`Ada Placeholder put it plainly:\n\n> ${INVENTED}`), null);
});

test('E: a CJK attribution cue plus invented sentence is dropped with no corpus', async () => {
  assert.equal(await respondWith('某人说过：甲乙丙丁戊己庚辛壬癸。'), null);
});

test('E: plain conversation with no colon and no cue survives with no corpus', async () => {
  const text = 'Good morning. The weather is agreeable today.';
  assert.equal(await respondWith(text), text);
});

test('E: quoting the user back in straight double quotes survives with no corpus', async () => {
  const text = 'You said "the quick brown fox is fast" and I agree with you.';
  assert.equal(await respondWith(text), text);
});

test('E: a stray straight quote survives with no corpus', async () => {
  const text = 'The bar was 6" off the floor and he still pulled it.';
  assert.equal(await respondWith(text), text);
});

test('E: a short CJK phrase in corner brackets survives with no corpus', async () => {
  const text = '「甲乙丙丁」 is all he offered.';
  assert.equal(await respondWith(text), text);
});

test('E: a colon with no attribution cue survives with no corpus', async () => {
  const text = 'Here is the thing: I disagree with almost all of that.';
  assert.equal(await respondWith(text), text);
});

test('E: with a corpus an invented delimited quotation is still dropped', async () => {
  assert.equal(await respondWith(`He wrote, "${INVENTED}"`, NEUTRAL_CHUNKS), null);
});

test('E: with a corpus a verbatim delimited quotation still reaches the channel', async () => {
  const text = 'He wrote, "The quick brown fox jumps over the lazy dog."';
  assert.equal(await respondWith(text, NEUTRAL_CHUNKS), text);
});

test('E: with a corpus an undelimited attribution is still dropped', async () => {
  assert.equal(
    await respondWith(`As Ada Placeholder wrote in Some Work: ${INVENTED}`, NEUTRAL_CHUNKS),
    null,
  );
});

// --- Old Lu stage 1: failures carry their cause --------------------------------
//
// "lu explain" and the headache signal need to know why a reply was dropped.
// respond() keeps returning null so every test above stays as it was.

test('respondWithReason returns the reply when it passes', async () => {
  const out = await respondWithReason({
    message: 'hello', chunks: [], history: [], persona, llm: llmReturning('good morning comrade'), config,
  });
  assert.deepEqual(out, { ok: true, reply: 'good morning comrade' });
});

test('respondWithReason names an empty reply', async () => {
  const out = await respondWithReason({
    message: 'hello', chunks: [], history: [], persona, llm: llmReturning('<think>hmm</think>'), config,
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /empty reply/);
});

test('respondWithReason names a failed quote check', async () => {
  const out = await respondWithReason({
    message: 'what did he say?', chunks, history: [], persona,
    llm: llmReturning('He wrote, "This sentence appears in no supplied chunk at all."'), config,
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /^quote check failed: /);
});

test('respondWithReason passes the abort signal to the model call', async () => {
  let seen;
  const llm = { async chat(args) { seen = args.signal; return 'ok comrade'; } };
  const controller = new AbortController();
  await respondWithReason({ message: 'hi', chunks: [], history: [], persona, llm, config, signal: controller.signal });
  assert.equal(seen, controller.signal);
});
