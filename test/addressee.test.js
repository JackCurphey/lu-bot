import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAddresseeMessages, parseAddresseeAnswer, isAddressedToLu, hasModel, ADDRESSEE_SYSTEM,
} from '../src/addressee.js';

const config = { llm: { addresseeModel: 'small' }, trigger: { addresseeTimeoutSeconds: 15 } };
const entries = [
  { name: 'Lu', isLu: true, text: 'the state is a tool' },
  { name: 'sam', isLu: false, text: 'a tool for what exactly' },
];

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeoutImpl: (id) => { timers.delete(id); },
    fireAll() { const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); },
  };
}

// --- Prompt --------------------------------------------------------------------
//
// Prompt length is nearly the whole cost of this call on the mini's CPU, so
// the prompt is held to a budget rather than to exact wording.

test('the system prompt is short and asks for YES or NO about Lu', () => {
  assert.ok(ADDRESSEE_SYSTEM.length <= 300, `system prompt is ${ADDRESSEE_SYSTEM.length} chars`);
  assert.match(ADDRESSEE_SYSTEM, /Lu/);
  assert.match(ADDRESSEE_SYSTEM, /YES/);
  assert.match(ADDRESSEE_SYSTEM, /NO/);
});

test('the conversation is one "name: text" line per message, Lu named as Lu', () => {
  const [system, user] = buildAddresseeMessages({ entries });
  assert.equal(system.role, 'system');
  assert.equal(user.role, 'user');
  assert.equal(user.content, 'Lu: the state is a tool\nsam: a tool for what exactly');
});

// --- Parsing: anything unclear is NO -------------------------------------------

test('YES and NO are read case-insensitively, with punctuation around them', () => {
  assert.equal(parseAddresseeAnswer('YES').yes, true);
  assert.equal(parseAddresseeAnswer(' yes.').yes, true);
  assert.equal(parseAddresseeAnswer('No').yes, false);
});

test('reasoning is stripped before reading the answer', () => {
  assert.equal(parseAddresseeAnswer('<think>they asked lu</think>YES').yes, true);
});

test('an answer that is not clearly YES or NO counts as NO', () => {
  for (const raw of ['maybe', 'yesterday', '', 'I think yes']) {
    const out = parseAddresseeAnswer(raw);
    assert.equal(out.yes, false, raw);
    assert.equal(out.reason, 'unclear answer', raw);
  }
});

// --- The call ------------------------------------------------------------------

test('asks the addressee model at temperature 0 with a tiny token cap', async () => {
  let seen;
  const llm = { async chat(args) { seen = args; return 'YES'; } };
  const out = await isAddressedToLu({ entries, llm, config });
  assert.deepEqual(out, { yes: true, reason: '' });
  assert.equal(seen.model, 'small');
  assert.equal(seen.temperature, 0);
  assert.equal(seen.maxTokens, 3);
});

test('a model error counts as NO, with the cause', async () => {
  const llm = { async chat() { throw new Error('Model server request to /chat/completions failed with status 500'); } };
  const out = await isAddressedToLu({ entries, llm, config });
  assert.equal(out.yes, false);
  assert.match(out.reason, /^judge error: .*500/);
});

test('a slow model counts as NO once the timeout passes', async () => {
  const timers = fakeTimers();
  const llm = { chat: () => new Promise(() => {}) };
  const pending = isAddressedToLu({ entries, llm, config, ...timers });
  timers.fireAll();
  const out = await pending;
  assert.equal(out.yes, false);
  assert.equal(out.reason, 'judge timed out after 15s');
});

test('when the model is not installed, the answer is NO without calling it', async () => {
  let called = false;
  const llm = { async chat() { called = true; return 'YES'; } };
  const out = await isAddressedToLu({ entries, llm, config, available: false });
  assert.equal(out.yes, false);
  assert.equal(called, false);
  assert.match(out.reason, /not installed/);
});

test('hasModel matches exact ids, and an untagged name against :latest', () => {
  assert.equal(hasModel(['qwen3:4b-instruct'], 'qwen3:4b-instruct'), true);
  assert.equal(hasModel(['qwen3:latest'], 'qwen3'), true);
  assert.equal(hasModel(['qwen3:4b-instruct'], 'qwen3:1.7b'), false);
});
