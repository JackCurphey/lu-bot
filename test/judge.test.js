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
