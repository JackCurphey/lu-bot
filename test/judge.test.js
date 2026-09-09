import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgeMessages, shouldUseCorpus } from '../src/judge.js';

const chunks = [{ text: 'Political power grows out of the barrel of a gun.', source: { title: 'T', author: 'A' } }];
const config = { llm: { judgeModel: 'judge' } };
const llmSaying = (content) => ({ async chat() { return content; } });

test('the judge prompt carries the message and the candidate passage', () => {
  const messages = buildJudgeMessages({ message: 'what about power?', chunks });
  const joined = messages.map((m) => m.content).join('\n');
  assert.ok(joined.includes('what about power?'));
  assert.ok(joined.includes('barrel of a gun'));
  assert.match(joined, /json/i);
});

test('an affirmative judgement uses the corpus', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('{"useCorpus": true, "reason": "direct"}'), config,
  });
  assert.equal(out, true);
});

test('a negative judgement does not', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('{"useCorpus": false, "reason": "small talk"}'), config,
  });
  assert.equal(out, false);
});

test('no chunks means no model call at all', async () => {
  let called = false;
  const llm = { async chat() { called = true; return '{"useCorpus": true}'; } };
  const out = await shouldUseCorpus({ message: 'm', chunks: [], llm, config });
  assert.equal(out, false);
  assert.equal(called, false);
});

test('an unparseable answer fails closed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('Well, I think probably yes?'), config,
  });
  assert.equal(out, false);
});

test('a missing field fails closed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('{"reason": "forgot the field"}'), config,
  });
  assert.equal(out, false);
});

test('a thrown model error fails closed rather than propagating', async () => {
  const llm = { async chat() { throw new Error('LM Studio down'); } };
  const out = await shouldUseCorpus({ message: 'm', chunks, llm, config });
  assert.equal(out, false);
});

test('JSON wrapped in prose or fences is still parsed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('```json\n{"useCorpus": true}\n```'), config,
  });
  assert.equal(out, true);
});

// --- Explicit extraction rule: pinning tests (per review finding) ---

test('two verdict objects in one reply fails closed (ambiguous)', async () => {
  const out = await shouldUseCorpus({
    message: 'm',
    chunks,
    llm: llmSaying('{"useCorpus": false} then reconsidering: {"useCorpus": true}'),
    config,
  });
  assert.equal(out, false);
});

test('prose braces plus a verdict fails closed (ambiguous)', async () => {
  const out = await shouldUseCorpus({
    message: 'm',
    chunks,
    llm: llmSaying('I considered {this} and {that}. {"useCorpus": true}'),
    config,
  });
  assert.equal(out, false);
});

test('useCorpus as a number fails closed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('{"useCorpus": 1}'), config,
  });
  assert.equal(out, false);
});

test('useCorpus as a string fails closed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('{"useCorpus": "true"}'), config,
  });
  assert.equal(out, false);
});

test('a nested useCorpus field (not at the top level) fails closed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('{"outer": {"useCorpus": true}}'), config,
  });
  assert.equal(out, false);
});

test('unparseable prose with no braces at all fails closed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('no braces here whatsoever'), config,
  });
  assert.equal(out, false);
});

test('an empty string reply fails closed', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying(''), config,
  });
  assert.equal(out, false);
});

test('a prose prefix without braces still lets the verdict through', async () => {
  const out = await shouldUseCorpus({
    message: 'm', chunks, llm: llmSaying('Sure: {"useCorpus": true}'), config,
  });
  assert.equal(out, true);
});

test('a fenced verdict with a brace-free prose prefix still lets the verdict through', async () => {
  const out = await shouldUseCorpus({
    message: 'm',
    chunks,
    llm: llmSaying('Here is my answer:\n```json\n{"useCorpus": true}\n```'),
    config,
  });
  assert.equal(out, true);
});
