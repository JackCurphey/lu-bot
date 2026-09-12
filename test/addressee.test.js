import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAddresseeMessages, parseAddresseeAnswer, isAddressedToLu, hasModel, ADDRESSEE_SYSTEM,
  ADDRESSEE_LINE_CHARS,
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

// --- Prompt size: a real-conversation window must stay judge-fast --------------
//
// Lu's own replies run 120-200 words; fed verbatim into the judge prompt they
// pushed a real 6-entry window past 700 tokens, which at ~25 tok/s on the
// deployment host's CPU always missed the 15s timeout. Each line is bounded.

test('a long entry is truncated to ADDRESSEE_LINE_CHARS plus an ellipsis, a short one is untouched', () => {
  const longText = 'x'.repeat(400);
  const shortText = 'a tool for what exactly';
  const [, user] = buildAddresseeMessages({
    entries: [
      { name: 'sam', isLu: false, text: longText },
      { name: 'sam', isLu: false, text: shortText },
    ],
  });
  const [longLine, shortLine] = user.content.split('\n');
  assert.equal(longLine, `sam: ${'x'.repeat(ADDRESSEE_LINE_CHARS)}…`);
  assert.equal(longLine.length, 'sam: '.length + ADDRESSEE_LINE_CHARS + 1);
  assert.equal(shortLine, `sam: ${shortText}`);
});

test('truncation applies to Lu\'s own lines too, when they are context and not the last entry', () => {
  const longText = 'y'.repeat(400);
  const [, user] = buildAddresseeMessages({
    entries: [
      { name: 'Lu', isLu: true, text: longText },
      { name: 'sam', isLu: false, text: 'short last entry' },
    ],
  });
  const [luLine] = user.content.split('\n');
  assert.equal(luLine, `Lu: ${'y'.repeat(ADDRESSEE_LINE_CHARS)}…`);
});

test('name prefixes and line order survive truncation', () => {
  const [, user] = buildAddresseeMessages({
    entries: [
      { name: 'Lu', isLu: true, text: 'z'.repeat(400) },
      { name: 'sam', isLu: false, text: 'w'.repeat(400) },
    ],
  });
  const lines = user.content.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Lu: /);
  assert.match(lines[1], /^sam: /);
});

test('a whole 6-entry window of long messages stays well under the old 700-token prompt', () => {
  // The last entry is the message under judgment and is never truncated (see
  // below), so this fixture caps only the 5 context entries' length and lets
  // the last one run long too -- the bound still has to hold with one full
  // line in the mix, which is the real shape of every judge call.
  const longReply = 'This is a much longer reply that runs well over a hundred words. '.repeat(3);
  const sixEntries = Array.from({ length: 6 }, (_, i) => ({
    name: i % 2 === 0 ? 'Lu' : 'sam',
    isLu: i % 2 === 0,
    text: longReply,
  }));
  const [, user] = buildAddresseeMessages({ entries: sixEntries });
  // 5 context lines truncated to 120 chars + 1 full last line (~200 chars).
  assert.ok(user.content.length < 950, `user content is ${user.content.length} chars`);
});

// --- The last entry is the message under judgment: never truncate it ----------
//
// ADDRESSEE_SYSTEM tells the judge to rule on ONLY the last message.
// Addressing cues ("...right, Lu?") often sit at the very end of a sentence,
// so truncating that entry at 120 chars can strip the cue that would have
// produced YES, turning it into a false NO that did not exist before
// truncation was added. Context entries (everything but the last) still get
// truncated for prompt-size reasons.

test('the last entry is passed through in full even when long; earlier long entries are still truncated', () => {
  const longContext = 'c'.repeat(400);
  const longLast = `${'x'.repeat(200)} right, Lu?`;
  const [, user] = buildAddresseeMessages({
    entries: [
      { name: 'sam', isLu: false, text: longContext },
      { name: 'sam', isLu: false, text: longLast },
    ],
  });
  const [contextLine, lastLine] = user.content.split('\n');
  assert.equal(contextLine, `sam: ${'c'.repeat(ADDRESSEE_LINE_CHARS)}…`);
  assert.equal(lastLine, `sam: ${longLast}`);
  assert.ok(!lastLine.includes('…'), 'the judged message must not be truncated');
  assert.match(lastLine, /right, Lu\?$/);
});

// --- Truncation must be codepoint-safe, not UTF-16-unit-safe -------------------
//
// text.slice(0, N) counts UTF-16 code units, so it can cut a non-BMP
// character (e.g. an emoji) in half, producing a broken/unpaired surrogate in
// the prompt. Truncation must operate on codepoints.

test('truncation does not split an emoji straddling the 120-codepoint boundary', () => {
  // 119 'a' codepoints + one 2-code-unit emoji spanning codepoints 119/120,
  // followed by more filler so this is a context (non-last) entry.
  const emoji = '😀';
  const text = `${'a'.repeat(119)}${emoji}${'b'.repeat(50)}`;
  const [, user] = buildAddresseeMessages({
    entries: [
      { name: 'sam', isLu: false, text },
      { name: 'sam', isLu: false, text: 'short last entry' },
    ],
  });
  const [contextLine] = user.content.split('\n');
  assert.match(contextLine, /…$/);
  const truncated = contextLine.slice('sam: '.length, -1); // strip prefix and trailing …
  assert.equal([...truncated].length, ADDRESSEE_LINE_CHARS);
  const codepoints = [...truncated];
  assert.equal(codepoints[codepoints.length - 1], emoji, 'must not cut the emoji in half');
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
