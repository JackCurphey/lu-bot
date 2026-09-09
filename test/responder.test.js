import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, respond, stripThinking } from '../src/responder.js';

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
