import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, respond } from '../src/responder.js';

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
