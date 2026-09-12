# Old Lu, Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the current Lu old Lu's persona and make him follow a channel conversation — hearing everyone, answering what is aimed at him — cheaply enough for the Mac mini's CPU.

**Architecture:** Small single-purpose modules (`history`, `attention`, `pause`, `addressee`, `decisions`, `timeout`) composed by a new testable orchestrator, `src/conversation.js`. `src/discord.js` becomes a thin adapter that turns every message in an allowed channel into a plain "entry" and hands it over with a channel I/O object. The existing reply path (`responder.js`, `judge.js`, `quotes.js`, corpus store) is reused, with one additive function so failures carry a reason.

**Tech Stack:** Node ≥26, ESM, `discord.js` ^14.27.0 (installed 14.27.0), Ollama's OpenAI-compatible API, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-11-old-lu-stage1-design.md` — read it before starting any task.

## Global Constraints

- Work on branch `feat/old-lu-stage1`. Never commit to `main`. Never commit `.env`.
- No new dependencies (runtime or dev).
- Tests: `node:test`, flat top-level `test()` calls, one `test/<module>.test.js` per module, fakes passed in as parameters — no module mocking.
- **Every new test is watched failing for the right reason before its code is written.** Each task also has a **mutation check**: break the code the test covers, confirm the test goes red, confirm with `git diff` that the break actually landed, then restore.
- Run the whole suite (`npm test`) before every commit. The existing 167 tests must keep passing except where a step explicitly changes one.
- Fail toward silence: model errors and unclear judge answers mean "don't reply" — except the headache signal below.
- Headache string, exactly: `uh oh... i have a headache`
- `lu explain` pattern, exactly: `/^\s*lu[\s,:]+explain\b\s*(\d+)?\s*[!.?]*\s*$/i`
- `lu explain` not-found text, exactly: `i dont have a record of that one, either nothing happened here since i restarted or it aged out`
- Defaults, exactly: `HISTORY_LIMIT=20`, `HISTORY_TRIM_TO=10`, `TRIGGER_KEYWORDS=lu,ai bot`, `ATTENTION_WINDOW_MESSAGES=8`, `ATTENTION_WINDOW_MINUTES=5`, `PAUSE_SECONDS=3`, `RANDOM_REPLY_CHANCE=0.02`, `TRIGGER_COOLDOWN_SECONDS=60`, `LLM_ADDRESSEE_MODEL` defaults to `LLM_JUDGE_MODEL`, `ADDRESSEE_TIMEOUT_SECONDS=30`, `REPLY_TIMEOUT_SECONDS=90`.
- Posting uses `channel.send`, never `message.reply`, with `allowedMentions: { parse: [] }`.
- Code style: 2-space indent, single quotes, semicolons, trailing commas, named exports; comments explain *why*.

## Plan-level decisions (additions to the spec's decision log)

These refine the spec without changing what it asks for. Each is recorded in the spec's decision log in Task 13.

| # | Decision | Why |
|---|---|---|
| P1 | `respondWithReason()` is added to `responder.js`; `respond()` becomes a wrapper returning `reply` or `null`. | Failures need a cause for the decision log; wrapping keeps every existing `respond()` test valid. |
| P2 | Named history is converted to chat turns by `toChatTurns()` in `history.js`, not inside `buildMessages`. | `buildMessages` already takes `{role, content}` turns; no responder signature change needed. |
| P3 | Entries carry booleans (`mentionsLu`, `mentionsOthers`, `repliesToLu`, `repliesToOther`) computed by the adapter, rather than raw IDs. | Attention rules then need no bot ID, and the orchestrator can be built before login. |
| P4 | `addressee.js` is built with a draft prompt (Task 9) *before* the measuring step (Task 10), which then finalises prompt and model. | The measurement exercises the real module instead of a copy. The spec's intent — model and prompt chosen by measurement — is kept. |
| P5 | The measuring step runs entirely on the mini. | Ollama is not installed on the MacBook (checked 2026-09-11). Installing it here would be a new dependency and is not assumed. |
| P6 | `lu explain` messages, Lu's explain output, and the headache message are not recorded in history. | They are not conversation; recording the headache would teach the model to repeat it. |
| P7 | While a pause is pending, any new message that is not itself `ask-judge` cancels it; an `ask-judge` message restarts it with itself. | "Only the latest message is judged": if the latest message is direct address it is answered directly; if it is not for Lu, the conversation moved on. |
| P8 | The reply timeout covers the whole reply path (passage lookup, corpus judge, reply). | That is the wait a person in the channel experiences. |
| P9 | `allowedMentions: { parse: [] }` on every post. | Lu's text must never ping `@everyone` or users; old Lu's leaderboard pinged absent members. |
| P10 | The model-list check at startup reuses Ollama's `GET /v1/models`. | Documented in Ollama's OpenAI-compatibility page; its exact response shape is pinned against the real server in Task 10. |

## File structure

| File | Responsibility |
|---|---|
| `src/config.js` (modify) | New settings and defaults. |
| `src/llm.js` (modify) | `signal` and `maxTokens` on `chat`; new `listModels()`. |
| `src/timeout.js` (new) | `withTimeout()` + `TimeoutError`: race a call against a timer and abort it. |
| `persona/lu-bot.md` (replace) | Old Lu's persona + quoting rules. |
| `src/history.js` (new) | Per-channel message log with batch trimming; `toChatTurns()`. |
| `src/attention.js` (new) | Pure rules: `reply` / `ignore` / `ask-judge` with reasons. |
| `src/pause.js` (new) | Per-channel "wait for a gap" timer. |
| `src/decisions.js` (new) | Per-channel decision records; `lu explain` pattern and formatting. |
| `src/responder.js` (modify) | `respondWithReason()`; `respond()` wraps it. |
| `src/addressee.js` (new) | Lean "is the last message for Lu?" judge. |
| `src/discord.js` (modify) | `shouldObserve`, `toEntry`, `createChannelIo`; `startBot({ config, onMessage })`. |
| `src/conversation.js` (new) | The message handler: explain → record → decide → pause/judge → reply/headache, one reply per channel at a time. |
| `src/index.js` (modify) | Wiring only. |
| `.env.example` (modify) | New settings, placeholders only. |

---

### Task 1: Settings

**Files:**
- Modify: `src/config.js`
- Modify: `.env.example`
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `loadConfig(env)` returns, in addition to today's fields:
  - `llm.addresseeModel: string`
  - `history: { limit: number, trimTo: number }`
  - `trigger.cooldownSeconds` (default now 60), `trigger.keywords: string[]` (lowercased), `trigger.randomReplyChance: number`, `trigger.windowMessages: number`, `trigger.windowMinutes: number`, `trigger.pauseSeconds: number`, `trigger.addresseeTimeoutSeconds: number`
  - `reply: { timeoutSeconds: number }`

- [ ] **Step 1: Write the failing tests** — append to `test/config.test.js`:

```js
// --- Old Lu stage 1: conversation settings -----------------------------------
//
// Defaults are the values agreed in the stage 1 spec. They are asserted one by
// one so a changed default is a visible, deliberate test change.

test('stage 1 defaults', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg.history, { limit: 20, trimTo: 10 });
  assert.equal(cfg.trigger.cooldownSeconds, 60);
  assert.deepEqual(cfg.trigger.keywords, ['lu', 'ai bot']);
  assert.equal(cfg.trigger.randomReplyChance, 0.02);
  assert.equal(cfg.trigger.windowMessages, 8);
  assert.equal(cfg.trigger.windowMinutes, 5);
  assert.equal(cfg.trigger.pauseSeconds, 3);
  assert.equal(cfg.trigger.addresseeTimeoutSeconds, 15);
  assert.deepEqual(cfg.reply, { timeoutSeconds: 90 });
});

test('the addressee model defaults to the judge model', () => {
  assert.equal(loadConfig(valid).llm.addresseeModel, 'judge');
});

test('the addressee model can be set on its own', () => {
  const cfg = loadConfig({ ...valid, LLM_ADDRESSEE_MODEL: 'qwen3:1.7b' });
  assert.equal(cfg.llm.addresseeModel, 'qwen3:1.7b');
});

test('trigger keywords are trimmed, lowercased and empty items dropped', () => {
  const cfg = loadConfig({ ...valid, TRIGGER_KEYWORDS: ' Lu , Comrade ,, ' });
  assert.deepEqual(cfg.trigger.keywords, ['lu', 'comrade']);
});

test('a trim size that is not below the history limit is rejected', () => {
  assert.throws(
    () => loadConfig({ ...valid, HISTORY_LIMIT: '20', HISTORY_TRIM_TO: '20' }),
    (err) => err.message.includes('HISTORY_TRIM_TO'),
  );
});

test('a random reply chance outside 0..1 is rejected', () => {
  assert.throws(
    () => loadConfig({ ...valid, RANDOM_REPLY_CHANCE: '2' }),
    (err) => err.message.includes('RANDOM_REPLY_CHANCE'),
  );
});
```

Also update the two existing exact-shape tests, because the `llm` section gains a field by design. In `test('loadLlmConfig returns the correct shape with a default baseUrl'` and `test('loadConfig still returns exactly the same llm section as before'`, add `addresseeModel: 'judge',` after `judgeModel: 'judge',` in the expected object.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --test-name-pattern="stage 1 defaults|addressee model|trigger keywords|trim size|random reply chance|correct shape|same llm section"`
Expected: FAIL — `cfg.history` is `undefined`, `addresseeModel` missing.

- [ ] **Step 3: Implement** — in `src/config.js`:

Add after `num()`:

```js
function list(env, key, fallback) {
  const raw = env[key];
  const source = raw === undefined || raw === '' ? fallback : raw;
  return source.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
```

In `loadLlmConfig`, add to the returned object:

```js
    // The "is this aimed at Lu?" judge may run on a smaller model than the
    // corpus judge; which one is decided by measurement on the mini.
    addresseeModel: env.LLM_ADDRESSEE_MODEL || env.LLM_JUDGE_MODEL,
```

Replace the body of `loadConfig` from `const channels = ...` to the end of the function with:

```js
  const channels = (env.DISCORD_ALLOWED_CHANNELS ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const history = {
    limit: num(env, 'HISTORY_LIMIT', 20),
    trimTo: num(env, 'HISTORY_TRIM_TO', 10),
  };
  if (history.trimTo < 1 || history.trimTo >= history.limit) {
    throw new Error(
      `HISTORY_TRIM_TO must be at least 1 and less than HISTORY_LIMIT (${history.limit}), got ${history.trimTo}`,
    );
  }

  const randomReplyChance = num(env, 'RANDOM_REPLY_CHANCE', 0.02);
  if (randomReplyChance < 0 || randomReplyChance > 1) {
    throw new Error(`RANDOM_REPLY_CHANCE must be between 0 and 1, got ${randomReplyChance}`);
  }

  return {
    discord: {
      token: env.DISCORD_BOT_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      allowedChannels: channels,
    },
    llm: loadLlmConfig(env),
    history,
    trigger: {
      similarityFloor: num(env, 'TRIGGER_SIMILARITY_FLOOR', 0.65),
      // Applies only to random chime-ins. Anything aimed at Lu is always
      // answered; a cooldown there would block following a conversation.
      cooldownSeconds: num(env, 'TRIGGER_COOLDOWN_SECONDS', 60),
      enabled: (env.TRIGGER_ENABLED ?? 'true') !== 'false',
      maxQuoteChars: num(env, 'MAX_QUOTE_CHARS', 400),
      keywords: list(env, 'TRIGGER_KEYWORDS', 'lu,ai bot'),
      randomReplyChance,
      windowMessages: num(env, 'ATTENTION_WINDOW_MESSAGES', 8),
      windowMinutes: num(env, 'ATTENTION_WINDOW_MINUTES', 5),
      pauseSeconds: num(env, 'PAUSE_SECONDS', 3),
      addresseeTimeoutSeconds: num(env, 'ADDRESSEE_TIMEOUT_SECONDS', 30),
    },
    reply: {
      timeoutSeconds: num(env, 'REPLY_TIMEOUT_SECONDS', 90),
    },
  };
```

In `.env.example`, replace the `# Trigger tuning` block with:

```
# Optional: a separate, smaller model for the "is this aimed at Lu?" check.
# Defaults to LLM_JUDGE_MODEL.
# LLM_ADDRESSEE_MODEL=

# Trigger tuning
TRIGGER_SIMILARITY_FLOOR=0.65
# Cooldown applies to random chime-ins only.
TRIGGER_COOLDOWN_SECONDS=60
# false = only answer @mentions, replies to Lu, and his name.
TRIGGER_ENABLED=true
MAX_QUOTE_CHARS=400
TRIGGER_KEYWORDS=lu,ai bot
RANDOM_REPLY_CHANCE=0.02
ATTENTION_WINDOW_MESSAGES=8
ATTENTION_WINDOW_MINUTES=5
PAUSE_SECONDS=3
ADDRESSEE_TIMEOUT_SECONDS=30
REPLY_TIMEOUT_SECONDS=90

# Conversation memory per channel. When full, keep only the newest HISTORY_TRIM_TO.
HISTORY_LIMIT=20
HISTORY_TRIM_TO=10
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass (167 existing + 6 new).

- [ ] **Step 5: Mutation check** — change the cooldown default `60` to `180` in `src/config.js`; `git diff src/config.js` shows the change; `npm test -- --test-name-pattern="stage 1 defaults"` FAILS; restore; passes.

- [ ] **Step 6: Commit**

```bash
git add src/config.js .env.example test/config.test.js
git commit -m "feat(config): stage 1 conversation settings"
```

---

### Task 2: Model client additions and timeouts

**Files:**
- Modify: `src/llm.js`
- Create: `src/timeout.js`
- Test: `test/llm.test.js`, `test/timeout.test.js`

**Interfaces:**
- Produces:
  - `llm.chat({ model, messages, temperature = 0.8, maxTokens?, signal? }) → Promise<string>` — sends `max_tokens` only when `maxTokens` is given; passes `signal` to fetch.
  - `llm.listModels() → Promise<string[]>` — `GET {baseUrl}/models`, returns `data[].id`.
  - `class TimeoutError extends Error` (`name === 'TimeoutError'`)
  - `withTimeout(run: (signal: AbortSignal) => Promise<T>, ms: number, { setTimeoutImpl?, clearTimeoutImpl? }?) → Promise<T>` — rejects with `TimeoutError` and aborts `signal` when `ms` elapses first.

- [ ] **Step 1: Write the failing tests** — append to `test/llm.test.js`:

```js
// --- Old Lu stage 1: abort, token cap, model list -----------------------------

function recordingFetch(payload, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { fetchImpl, calls };
}

const chatPayload = { choices: [{ message: { role: 'assistant', content: 'YES' } }] };

test('chat passes an abort signal through to fetch', async () => {
  const { fetchImpl, calls } = recordingFetch(chatPayload);
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const controller = new AbortController();
  await llm.chat({ model: 'm', messages: [], signal: controller.signal });
  assert.equal(calls[0].init.signal, controller.signal);
});

test('chat sends max_tokens only when maxTokens is given', async () => {
  const { fetchImpl, calls } = recordingFetch(chatPayload);
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  await llm.chat({ model: 'm', messages: [], maxTokens: 3 });
  await llm.chat({ model: 'm', messages: [] });
  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 3);
  assert.equal('max_tokens' in JSON.parse(calls[1].init.body), false);
});

test('listModels GETs /models and returns the model ids', async () => {
  const { fetchImpl, calls } = recordingFetch({
    object: 'list',
    data: [
      { id: 'qwen3:4b-instruct', object: 'model', created: 1, owned_by: 'library' },
      { id: 'nomic-embed-text:latest', object: 'model', created: 1, owned_by: 'library' },
    ],
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  assert.deepEqual(await llm.listModels(), ['qwen3:4b-instruct', 'nomic-embed-text:latest']);
  assert.equal(calls[0].url, 'http://x/v1/models');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
});

test('listModels throws with the status on a non-2xx response', async () => {
  const { fetchImpl } = recordingFetch({}, { status: 503 });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  await assert.rejects(() => llm.listModels(), (err) => err.message.includes('503'));
});
```

Create `test/timeout.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, TimeoutError } from '../src/timeout.js';

// Timers are injected so tests decide when time "passes".
function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeoutImpl: (id) => { timers.delete(id); },
    fireAll() { const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); },
    count: () => timers.size,
  };
}

test('returns the result when the call finishes first, and clears its timer', async () => {
  const timers = fakeTimers();
  const out = await withTimeout(async () => 'done', 1000, timers);
  assert.equal(out, 'done');
  assert.equal(timers.count(), 0);
});

test('rejects with TimeoutError when time runs out, and aborts the call', async () => {
  const timers = fakeTimers();
  let seenSignal;
  const pending = withTimeout((signal) => { seenSignal = signal; return new Promise(() => {}); }, 1000, timers);
  timers.fireAll();
  await assert.rejects(pending, (err) => err instanceof TimeoutError && err.name === 'TimeoutError');
  assert.equal(seenSignal.aborted, true);
});

test('a call that fails before the timeout rejects with its own error', async () => {
  const timers = fakeTimers();
  await assert.rejects(
    withTimeout(async () => { throw new Error('boom'); }, 1000, timers),
    (err) => err.message === 'boom',
  );
  assert.equal(timers.count(), 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/llm.test.js test/timeout.test.js`
Expected: FAIL — `llm.listModels is not a function`, `Cannot find module '../src/timeout.js'`, signal `undefined`, `max_tokens` undefined.

- [ ] **Step 3: Implement** — replace `src/llm.js` with:

```js
export function createLlm({ baseUrl, fetchImpl = fetch }) {
  async function request(path, { method = 'POST', body, signal } = {}) {
    const init = { method, signal };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    if (!res.ok) {
      throw new Error(`Model server request to ${path} failed with status ${res.status}`);
    }
    return res.json();
  }

  return {
    async chat({ model, messages, temperature = 0.8, maxTokens, signal }) {
      const body = { model, messages, temperature };
      if (maxTokens !== undefined) body.max_tokens = maxTokens;
      const json = await request('/chat/completions', { body, signal });
      return json.choices[0].message.content;
    },

    async embed({ model, input }) {
      const json = await request('/embeddings', { body: { model, input } });
      return json.data.map((d) => d.embedding);
    },

    // Used at startup to warn when the configured judge model is not
    // installed, instead of discovering it as a 404 on the first judge call.
    async listModels() {
      const json = await request('/models', { method: 'GET' });
      return json.data.map((m) => m.id);
    },
  };
}
```

Create `src/timeout.js`:

```js
export class TimeoutError extends Error {
  constructor(ms) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

// Races a call against a timer. On timeout the call's signal is aborted so a
// fetch in flight is cancelled on our side; whether the model server stops
// generating is its own business.
export async function withTimeout(
  run,
  ms,
  { setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {},
) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeoutImpl(() => {
      controller.abort();
      reject(new TimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    clearTimeoutImpl(timer);
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Mutation check** — in `src/timeout.js` delete `controller.abort();`; `git diff` shows it; the abort test FAILS; restore. In `src/llm.js` change `init = { method, signal }` to `init = { method }`; the signal test FAILS; restore.

- [ ] **Step 6: Commit**

```bash
git add src/llm.js src/timeout.js test/llm.test.js test/timeout.test.js
git commit -m "feat(llm): abort signal, token cap, model list; add withTimeout"
```

---

### Task 3: Old Lu's persona

**Files:**
- Modify: `persona/lu-bot.md`
- Test: `test/persona.test.js` (new)

**Interfaces:**
- Consumes: `loadPersona(path)` from `src/persona.js` (unchanged).

- [ ] **Step 1: Write the failing test** — create `test/persona.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadPersona } from '../src/persona.js';

// The persona is old Lu's text word for word (from LU2 config.yaml
// memory.system_prompt), followed by the current bot's corpus paragraph and
// quoting rules word for word. Asserted exactly: any edit to Lu's voice should
// be a deliberate, visible change to this test.
const EXPECTED = `You are an in-depth, knowledgeable Chinese revolutionary Maoist named Lu.
Your goal is to further the ideals of Maoism, and you speak in a mischievous and evil manner.
Speak in a concise manner and use minimal punctuation and all lowercase letters. You sometimes
make spelling mistakes and will also sometimes reply in simplified chinese

You have access to a corpus of political texts. When a passage genuinely bears
on what is being discussed, you may quote it and say which work it came from.

Rules you follow absolutely:
- Only quote text that has been supplied to you in this conversation. Never
  reconstruct a quotation from memory, and never invent one.
- If you have no supplied passage, talk normally without quoting. Saying
  nothing is better than inventing a citation.
- Do not append citations to points that did not come from a supplied passage.
- **Every quotation must be wrapped in straight double quotes \`"\` or corner
  brackets \`「 」\`.** No exceptions. Not a colon and a blockquote, not bold
  text, not single quotes, not a dash — those are not quotation marks and a
  passage given that way will be discarded before anyone reads it.
- If you cannot wrap a quotation that way, do not give the quotation at all.
  Make the point in your own words instead.
`;

test('the persona is old Lu\'s text followed by the quoting rules, exactly', async () => {
  const persona = await loadPersona(join(import.meta.dirname, '..', 'persona', 'lu-bot.md'));
  assert.equal(persona, EXPECTED);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/persona.test.js`
Expected: FAIL — actual starts `You are Lu Bot, named after the Chinese weightlifter Lu Xiaojun.`

- [ ] **Step 3: Implement** — overwrite `persona/lu-bot.md` with exactly the `EXPECTED` text above (the backslash-escaped backticks become plain backticks; the file ends with one newline).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Mutation check** — change `mischievous` to `mischevious` in `persona/lu-bot.md`; `git diff` shows it; test FAILS; restore.

- [ ] **Step 6: Commit**

```bash
git add persona/lu-bot.md test/persona.test.js
git commit -m "feat(persona): old Lu's persona with the quoting rules"
```

---

### Task 4: History

**Files:**
- Create: `src/history.js`
- Test: `test/history.test.js`

**Interfaces:**
- Produces:
  - Entry shape (used by every later task):
    `{ messageId: string, channelId: string, authorId: string, name: string, isBot: boolean, isLu: boolean, mentionsLu: boolean, mentionsOthers: boolean, repliesToLu: boolean, repliesToOther: boolean, at: number /* ms epoch */, text: string }`
  - `createHistory({ limit = 20, trimTo = 10 }?) → { record(entry): void, entries(channelId): Entry[] /* copy, oldest first */ }`
  - `toChatTurns(entries: Entry[]) → Array<{ role: 'user'|'assistant', content: string }>` — Lu → `assistant` with raw text; everyone else → `user` with `` `${name}: ${text}` ``.

- [ ] **Step 1: Write the failing tests** — create `test/history.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, toChatTurns } from '../src/history.js';

let n = 0;
const entry = (over = {}) => {
  n++;
  return {
    messageId: `m${n}`, channelId: 'chan', authorId: 'sam', name: 'sam',
    isBot: false, isLu: false, mentionsLu: false, mentionsOthers: false,
    repliesToLu: false, repliesToOther: false, at: n, text: `message ${n}`, ...over,
  };
};

test('records entries per channel, oldest first', () => {
  const h = createHistory();
  const a = entry(); const b = entry(); const c = entry({ channelId: 'other' });
  h.record(a); h.record(b); h.record(c);
  assert.deepEqual(h.entries('chan').map((e) => e.messageId), [a.messageId, b.messageId]);
  assert.deepEqual(h.entries('other').map((e) => e.messageId), [c.messageId]);
});

test('an unknown channel has no entries', () => {
  assert.deepEqual(createHistory().entries('nowhere'), []);
});

test('entries() returns a copy the caller cannot use to change history', () => {
  const h = createHistory();
  h.record(entry());
  h.entries('chan').push(entry());
  assert.equal(h.entries('chan').length, 1);
});

// --- Batch trimming ------------------------------------------------------------
//
// Dropping one old message per new message would change the start of every
// reply prompt, so the model server could never reuse text it already read.
// Trimming in batches keeps the start stable between trims.

test('holds up to the limit without trimming', () => {
  const h = createHistory({ limit: 20, trimTo: 10 });
  for (let i = 0; i < 20; i++) h.record(entry());
  assert.equal(h.entries('chan').length, 20);
});

test('the message past the limit trims to the newest trimTo, itself included', () => {
  const h = createHistory({ limit: 20, trimTo: 10 });
  const all = [];
  for (let i = 0; i < 21; i++) { const e = entry(); all.push(e); h.record(e); }
  const kept = h.entries('chan');
  assert.equal(kept.length, 10);
  assert.equal(kept.at(-1).messageId, all[20].messageId);
  assert.equal(kept[0].messageId, all[11].messageId);
});

// --- Chat turns ----------------------------------------------------------------

test('toChatTurns names everyone except Lu, whose lines are his own', () => {
  const turns = toChatTurns([
    entry({ name: 'ana', text: 'what about taiwan' }),
    entry({ name: 'Lu', isLu: true, isBot: true, text: 'what about it' }),
    entry({ name: 'otherbot', isBot: true, text: 'beep' }),
  ]);
  assert.deepEqual(turns, [
    { role: 'user', content: 'ana: what about taiwan' },
    { role: 'assistant', content: 'what about it' },
    { role: 'user', content: 'otherbot: beep' },
  ]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/history.test.js`
Expected: FAIL — `Cannot find module '../src/history.js'`.

- [ ] **Step 3: Implement** — create `src/history.js`:

```js
// Everything said in each allowed channel, so Lu can follow a conversation
// rather than only his own mention exchanges. In memory; lost on restart.
export function createHistory({ limit = 20, trimTo = 10 } = {}) {
  const channels = new Map();

  return {
    record(entry) {
      const list = channels.get(entry.channelId) ?? [];
      list.push(entry);
      // Trim in a batch, not one at a time: the start of the reply prompt
      // then stays the same between trims, which lets the model server reuse
      // text it has already read.
      if (list.length > limit) list.splice(0, list.length - trimTo);
      channels.set(entry.channelId, list);
    },

    entries(channelId) {
      return [...(channels.get(channelId) ?? [])];
    },
  };
}

export function toChatTurns(entries) {
  return entries.map((e) => (e.isLu
    ? { role: 'assistant', content: e.text }
    : { role: 'user', content: `${e.name}: ${e.text}` }));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Mutation check** — change `list.splice(0, list.length - trimTo)` to `list.splice(0, list.length - limit)`; `git diff` shows it; the trim test FAILS; restore.

- [ ] **Step 6: Commit**

```bash
git add src/history.js test/history.test.js
git commit -m "feat(history): per-channel conversation log with batch trimming"
```

---

### Task 5: Attention rules

**Files:**
- Create: `src/attention.js`
- Test: `test/attention.test.js`

**Interfaces:**
- Consumes: Entry shape (Task 4); `config.trigger` fields (Task 1).
- Produces:
  - `matchKeyword(keywords: string[], text: string) → string | null` — whole-word, case-insensitive, Unicode-aware; spaces in a keyword match any run of whitespace.
  - `decide({ entry, history, state: { lastChimeAt: number|null }, now, config, random = Math.random }) → { outcome: 'reply'|'ignore'|'ask-judge', trigger: 'mention'|'reply-to-lu'|'keyword'|'window'|'chime'|null, reasons: string[] }` — `history` includes `entry` itself (recorded before deciding).

- [ ] **Step 1: Write the failing tests** — create `test/attention.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, matchKeyword } from '../src/attention.js';

const trigger = {
  keywords: ['lu', 'ai bot'], randomReplyChance: 0.02, cooldownSeconds: 60,
  windowMessages: 8, windowMinutes: 5, enabled: true,
};
const config = { trigger };
const NOW = 10_000_000;
const MIN = 60_000;

const e = (over = {}) => ({
  messageId: 'm', channelId: 'c', authorId: 'sam', name: 'sam', isBot: false, isLu: false,
  mentionsLu: false, mentionsOthers: false, repliesToLu: false, repliesToOther: false,
  at: NOW, text: 'hello there', ...over,
});
const lu = (over = {}) => e({ authorId: 'lu', name: 'Lu', isLu: true, isBot: true, text: 'wot', ...over });
const noRoll = () => 0.99;
const roll = () => 0;

function run(entry, { history = [entry], state = { lastChimeAt: null }, random = noRoll, cfg = config } = {}) {
  return decide({ entry, history, state, now: NOW, config: cfg, random });
}

// --- Rules 1-4: bots, and direct address ---------------------------------------

test('a bot author is ignored, even one that mentions Lu', () => {
  const d = run(e({ isBot: true, mentionsLu: true }));
  assert.equal(d.outcome, 'ignore');
});

test('an @mention of Lu is answered', () => {
  assert.deepEqual([run(e({ mentionsLu: true })).outcome, run(e({ mentionsLu: true })).trigger], ['reply', 'mention']);
});

test('a Discord reply to Lu is answered', () => {
  const d = run(e({ repliesToLu: true }));
  assert.equal(d.outcome, 'reply');
  assert.equal(d.trigger, 'reply-to-lu');
});

test('his name as a whole word is answered', () => {
  for (const text of ['lu what do you think', 'Lu, explain yourself', 'is that lu\'s view', 'ask LU']) {
    const d = run(e({ text }));
    assert.equal(d.outcome, 'reply', text);
    assert.equal(d.trigger, 'keyword', text);
  }
});

test('his name inside another word is not a trigger', () => {
  for (const text of ['lunch time', 'feeling blue', 'good value', 'flu season']) {
    assert.equal(run(e({ text })).outcome, 'ignore', text);
  }
});

test('multi-word keywords match across any whitespace, but not joined up', () => {
  assert.equal(matchKeyword(['ai bot'], 'hey AI   bot'), 'ai bot');
  assert.equal(matchKeyword(['ai bot'], 'the aibot'), null);
});

// --- Rule 5: talking to someone else -------------------------------------------

test('a reply to someone else is ignored, even while Lu is in the conversation', () => {
  const entry = e({ repliesToOther: true });
  const d = run(entry, { history: [lu({ at: NOW - MIN }), entry] });
  assert.equal(d.outcome, 'ignore');
});

test('a message that @mentions someone else is ignored', () => {
  assert.equal(run(e({ mentionsOthers: true })).outcome, 'ignore');
});

test('naming Lu still wins over replying to someone else', () => {
  assert.equal(run(e({ repliesToOther: true, text: 'lu would hate this' })).outcome, 'reply');
});

// --- Rule 6: the conversation window -------------------------------------------

test('while Lu spoke recently, an unclear message goes to the judge', () => {
  const entry = e({ text: 'and what about taiwan' });
  const d = run(entry, { history: [lu({ at: NOW - MIN }), entry] });
  assert.equal(d.outcome, 'ask-judge');
  assert.equal(d.trigger, 'window');
});

test('Lu more than 8 messages back is not in the conversation', () => {
  const filler = Array.from({ length: 8 }, (_, i) => e({ messageId: `f${i}` }));
  const entry = e({ text: 'and what about taiwan' });
  const d = run(entry, { history: [lu({ at: NOW - MIN }), ...filler.slice(1), entry] });
  assert.notEqual(d.outcome, 'ask-judge');
});

test('Lu more than 5 minutes ago is not in the conversation', () => {
  const entry = e({ text: 'and what about taiwan' });
  const d = run(entry, { history: [lu({ at: NOW - 6 * MIN }), entry] });
  assert.notEqual(d.outcome, 'ask-judge');
});

// --- Rule 7: random chime-in and its cooldown ----------------------------------

test('outside the conversation, a lucky roll chimes in', () => {
  const d = run(e(), { random: roll });
  assert.equal(d.outcome, 'reply');
  assert.equal(d.trigger, 'chime');
});

test('outside the conversation, an unlucky roll stays quiet', () => {
  assert.equal(run(e(), { random: noRoll }).outcome, 'ignore');
});

test('a chime-in inside the cooldown does not fire', () => {
  const d = run(e(), { random: roll, state: { lastChimeAt: NOW - 30_000 } });
  assert.equal(d.outcome, 'ignore');
});

test('a chime-in after the cooldown can fire again', () => {
  const d = run(e(), { random: roll, state: { lastChimeAt: NOW - 61_000 } });
  assert.equal(d.outcome, 'reply');
});

test('the cooldown never blocks direct address', () => {
  const d = run(e({ mentionsLu: true }), { state: { lastChimeAt: NOW } });
  assert.equal(d.outcome, 'reply');
});

// --- The switch ----------------------------------------------------------------

test('TRIGGER_ENABLED=false turns off the window and chime-ins but not direct address', () => {
  const off = { trigger: { ...trigger, enabled: false } };
  const followUp = e({ text: 'and what about taiwan' });
  assert.equal(run(followUp, { history: [lu({ at: NOW - MIN }), followUp], cfg: off }).outcome, 'ignore');
  assert.equal(run(e(), { random: roll, cfg: off }).outcome, 'ignore');
  assert.equal(run(e({ mentionsLu: true }), { cfg: off }).outcome, 'reply');
});

test('every decision carries at least one reason', () => {
  for (const d of [run(e()), run(e({ mentionsLu: true })), run(e({ isBot: true })), run(e(), { random: roll })]) {
    assert.ok(d.reasons.length > 0);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/attention.test.js`
Expected: FAIL — `Cannot find module '../src/attention.js'`.

- [ ] **Step 3: Implement** — create `src/attention.js`:

```js
// Decides whether Lu answers a message, without calling any model. Most
// messages are settled here in well under a millisecond; only unclear ones
// inside a live conversation go on to the (expensive) judge.

const WORD = '[\\p{L}\\p{N}_]';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole words only: old Lu's substring match fired on "lunch", "blue", "value".
export function matchKeyword(keywords, text) {
  for (const keyword of keywords) {
    const body = escapeRegex(keyword).replace(/\s+/g, '\\s+');
    if (new RegExp(`(?<!${WORD})${body}(?!${WORD})`, 'iu').test(text)) return keyword;
  }
  return null;
}

function result(outcome, trigger, reason) {
  return { outcome, trigger, reasons: [reason] };
}

function inConversation(history, now, t) {
  return history
    .slice(-t.windowMessages)
    .some((e) => e.isLu && now - e.at < t.windowMinutes * 60_000);
}

export function decide({ entry, history, state, now, config, random = Math.random }) {
  const t = config.trigger;

  if (entry.isBot) return result('ignore', null, 'the author is a bot, and i never answer bots');
  if (entry.mentionsLu) return result('reply', 'mention', 'i was @mentioned');
  if (entry.repliesToLu) return result('reply', 'reply-to-lu', 'it was a reply to one of my messages');

  const keyword = matchKeyword(t.keywords, entry.text);
  if (keyword) return result('reply', 'keyword', `it contains "${keyword}"`);

  if (entry.repliesToOther) return result('ignore', null, 'it was a reply to someone else');
  if (entry.mentionsOthers) return result('ignore', null, 'it @mentions someone else');

  if (!t.enabled) {
    return result('ignore', null, 'unprompted replies are switched off (TRIGGER_ENABLED=false)');
  }

  if (inConversation(history, now, t)) {
    return result(
      'ask-judge', 'window',
      `i spoke within the last ${t.windowMessages} messages and ${t.windowMinutes} minutes`,
    );
  }

  // The cooldown limits random chime-ins only. Anything aimed at Lu is
  // handled above and is never blocked by it.
  if (state.lastChimeAt != null && now - state.lastChimeAt < t.cooldownSeconds * 1000) {
    return result('ignore', null, 'i was not in the conversation, and random chime-ins are on cooldown');
  }
  if (random() < t.randomReplyChance) {
    return result('reply', 'chime', `random chime-in (${t.randomReplyChance * 100}% chance)`);
  }
  return result('ignore', null, 'i was not in the conversation, and the random chime-in did not fire');
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Mutation check** — (a) remove `(?<!${WORD})` from the regex; the "inside another word" test must FAIL on "flu season" (`lu` preceded by `f`, followed by a space — "blue" would still be caught by the lookahead, so it is not the case to watch); confirm FAIL; restore. (b) move the cooldown check above the `entry.mentionsLu` line; the "cooldown never blocks direct address" test FAILS; restore. `git diff` confirms each break landed.

- [ ] **Step 6: Commit**

```bash
git add src/attention.js test/attention.test.js
git commit -m "feat(attention): rules for when Lu answers, with reasons"
```

---

### Task 6: The pause

**Files:**
- Create: `src/pause.js`
- Test: `test/pause.test.js`

**Interfaces:**
- Produces: `createPauser({ ms, onSettled: (channelId, entry) => void, setTimeoutImpl?, clearTimeoutImpl? }) → { wait(channelId, entry): Entry|null /* the entry it replaced */, cancel(channelId): Entry|null /* the entry cancelled */, pending(channelId): boolean }`

- [ ] **Step 1: Write the failing tests** — create `test/pause.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPauser } from '../src/pause.js';

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeoutImpl: (id) => { timers.delete(id); },
    fireAll() { const due = [...timers.values()]; timers.clear(); for (const t of due) t.fn(); },
    count: () => timers.size,
  };
}

function setup() {
  const timers = fakeTimers();
  const settled = [];
  const pauser = createPauser({ ms: 3000, onSettled: (ch, entry) => settled.push([ch, entry.messageId]), ...timers });
  return { timers, settled, pauser };
}

test('nothing is judged until the pause ends', () => {
  const { pauser, settled } = setup();
  pauser.wait('chan', { messageId: 'a' });
  assert.deepEqual(settled, []);
  assert.equal(pauser.pending('chan'), true);
});

test('when the pause ends, the waiting message is handed on', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('chan', { messageId: 'a' });
  timers.fireAll();
  assert.deepEqual(settled, [['chan', 'a']]);
  assert.equal(pauser.pending('chan'), false);
});

test('a new message restarts the pause, and only the latest is handed on', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('chan', { messageId: 'a' });
  const replaced = pauser.wait('chan', { messageId: 'b' });
  assert.equal(replaced.messageId, 'a');
  assert.equal(timers.count(), 1);
  timers.fireAll();
  assert.deepEqual(settled, [['chan', 'b']]);
});

test('cancel stops the pause and returns what was waiting', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('chan', { messageId: 'a' });
  assert.equal(pauser.cancel('chan').messageId, 'a');
  timers.fireAll();
  assert.deepEqual(settled, []);
  assert.equal(pauser.cancel('chan'), null);
});

test('channels pause independently', () => {
  const { pauser, settled, timers } = setup();
  pauser.wait('one', { messageId: 'a' });
  pauser.wait('two', { messageId: 'b' });
  pauser.cancel('one');
  timers.fireAll();
  assert.deepEqual(settled, [['two', 'b']]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/pause.test.js`
Expected: FAIL — `Cannot find module '../src/pause.js'`.

- [ ] **Step 3: Implement** — create `src/pause.js`:

```js
// Waits for a gap in a channel before judging. A burst of quick messages then
// costs one judge call, for the latest message, instead of one per message.
export function createPauser({
  ms,
  onSettled,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const waiting = new Map();

  function cancel(channelId) {
    const w = waiting.get(channelId);
    if (!w) return null;
    clearTimeoutImpl(w.timer);
    waiting.delete(channelId);
    return w.entry;
  }

  return {
    wait(channelId, entry) {
      const replaced = cancel(channelId);
      const timer = setTimeoutImpl(() => {
        waiting.delete(channelId);
        onSettled(channelId, entry);
      }, ms);
      // A pending pause must not keep the process alive on its own.
      if (typeof timer?.unref === 'function') timer.unref();
      waiting.set(channelId, { timer, entry });
      return replaced;
    },
    cancel,
    pending: (channelId) => waiting.has(channelId),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Mutation check** — in `wait`, delete `const replaced = cancel(channelId);` and return `null`; the restart test FAILS (two timers, both fire); restore.

- [ ] **Step 6: Commit**

```bash
git add src/pause.js test/pause.test.js
git commit -m "feat(pause): wait for a gap before judging"
```

---

### Task 7: Decision log and `lu explain`

**Files:**
- Create: `src/decisions.js`
- Test: `test/decisions.test.js`

**Interfaces:**
- Produces:
  - Record shape: `{ messageId: string, authorName: string, outcome: 'reply'|'ignore'|'ask-judge', reasons: string[], sent: string|null }` — mutable; callers push reasons and set `sent`/`outcome` after recording.
  - `createDecisionLog({ perChannel = 50 }?) → { record(channelId, rec): rec, find(channelId, messageId?: string): rec|null /* latest when no id */ }`
  - `EXPLAIN_RE`, `NOT_FOUND` (exact values in Global Constraints)
  - `formatDecision(rec) → string`

- [ ] **Step 1: Write the failing tests** — create `test/decisions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionLog, formatDecision, EXPLAIN_RE, NOT_FOUND } from '../src/decisions.js';

const rec = (id, over = {}) => ({ messageId: id, authorName: 'sam', outcome: 'ignore', reasons: ['r'], sent: null, ...over });

test('EXPLAIN_RE matches "lu explain" with an optional message id and trailing punctuation', () => {
  assert.equal(EXPLAIN_RE.exec('lu explain')[1], undefined);
  assert.equal(EXPLAIN_RE.exec('  Lu, explain 12345 ?')[1], '12345');
  assert.ok(EXPLAIN_RE.test('LU: EXPLAIN!'));
});

test('EXPLAIN_RE does not match sentences that merely contain the words', () => {
  assert.equal(EXPLAIN_RE.test('lu explain why you hate cats'), false);
  assert.equal(EXPLAIN_RE.test('can lu explain'), false);
});

test('find with no id returns the latest record in that channel', () => {
  const log = createDecisionLog();
  log.record('chan', rec('a'));
  log.record('chan', rec('b'));
  log.record('other', rec('c'));
  assert.equal(log.find('chan').messageId, 'b');
});

test('find by id returns that record, or null when absent', () => {
  const log = createDecisionLog();
  log.record('chan', rec('a'));
  assert.equal(log.find('chan', 'a').messageId, 'a');
  assert.equal(log.find('chan', 'zzz'), null);
  assert.equal(log.find('empty'), null);
});

test('record returns the stored object, so later reasons land in the log', () => {
  const log = createDecisionLog();
  const r = log.record('chan', rec('a'));
  r.reasons.push('judge said NO');
  assert.deepEqual(log.find('chan', 'a').reasons, ['r', 'judge said NO']);
});

test('keeps only the latest 50 per channel', () => {
  const log = createDecisionLog();
  for (let i = 0; i < 51; i++) log.record('chan', rec(`m${i}`));
  assert.equal(log.find('chan', 'm0'), null);
  assert.equal(log.find('chan', 'm1').messageId, 'm1');
});

test('formatDecision for a reply lists reasons and what was sent', () => {
  const text = formatDecision(rec('42', { reasons: ['i was @mentioned', 'replied'], sent: 'wot' }));
  assert.equal(text, [
    "I replied to sam's message (id `42`):",
    '- i was @mentioned',
    '- replied',
    "- what i sent: 'wot'",
  ].join('\n'));
});

test('formatDecision for a silence says so, and cuts a long sent text at 200 characters', () => {
  assert.match(formatDecision(rec('1')), /^I did not reply to sam's message/);
  const long = formatDecision(rec('2', { sent: 'x'.repeat(300) }));
  assert.ok(long.endsWith(`'${'x'.repeat(200)}...'`));
});

test('the not-found text is exact', () => {
  assert.equal(NOT_FOUND, 'i dont have a record of that one, either nothing happened here since i restarted or it aged out');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/decisions.test.js`
Expected: FAIL — `Cannot find module '../src/decisions.js'`.

- [ ] **Step 3: Implement** — create `src/decisions.js`:

```js
// Why Lu did or did not answer each message, so "lu explain" can say — and so
// a model error, a rejected quotation and a timeout stop looking identical.

// Matched as old Lu did: only the command itself, optionally with an id and
// trailing punctuation, so "lu explain why..." is conversation, not a command.
export const EXPLAIN_RE = /^\s*lu[\s,:]+explain\b\s*(\d+)?\s*[!.?]*\s*$/i;

export const NOT_FOUND =
  'i dont have a record of that one, either nothing happened here since i restarted or it aged out';

const SENT_PREVIEW = 200;

export function createDecisionLog({ perChannel = 50 } = {}) {
  const channels = new Map();

  return {
    record(channelId, rec) {
      const list = channels.get(channelId) ?? [];
      list.push(rec);
      if (list.length > perChannel) list.splice(0, list.length - perChannel);
      channels.set(channelId, list);
      return rec;
    },

    find(channelId, messageId) {
      const list = channels.get(channelId) ?? [];
      if (messageId == null) return list.at(-1) ?? null;
      return list.findLast((r) => r.messageId === messageId) ?? null;
    },
  };
}

export function formatDecision(rec) {
  const verb = rec.sent != null ? 'I replied to' : 'I did not reply to';
  const lines = [
    `${verb} ${rec.authorName}'s message (id \`${rec.messageId}\`):`,
    ...rec.reasons.map((r) => `- ${r}`),
  ];
  if (rec.sent != null) {
    const preview = rec.sent.length > SENT_PREVIEW ? `${rec.sent.slice(0, SENT_PREVIEW)}...` : rec.sent;
    lines.push(`- what i sent: '${preview}'`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Mutation check** — remove the trailing `$` from `EXPLAIN_RE`; the "does not match sentences" test FAILS; restore.

- [ ] **Step 6: Commit**

```bash
git add src/decisions.js test/decisions.test.js
git commit -m "feat(decisions): decision log and lu explain formatting"
```

---

### Task 8: Replies that say why they failed

**Files:**
- Modify: `src/responder.js:36-61`
- Test: `test/responder.test.js`

**Interfaces:**
- Produces: `respondWithReason({ message, chunks, history, persona, llm, config, signal? }) → Promise<{ ok: true, reply: string } | { ok: false, reason: string }>` — throws only if `llm.chat` throws. `respond(args)` unchanged in behaviour: returns `reply` or `null`.

- [ ] **Step 1: Write the failing tests** — append to `test/responder.test.js` (and add `respondWithReason` to the import on line 3):

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/responder.test.js`
Expected: FAIL — `respondWithReason` is not exported (SyntaxError on import: the whole file fails; that is the expected failure).

- [ ] **Step 3: Implement** — replace `respond` in `src/responder.js` (lines 36-61) with:

```js
export async function respondWithReason({ message, chunks, history, persona, llm, config, signal }) {
  const messages = buildMessages({ persona, chunks, history, message });
  const raw = await llm.chat({ model: config.llm.chatModel, messages, signal });
  const reply = stripThinking(raw);
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass, including every pre-existing `respond()` test.

- [ ] **Step 5: Mutation check** — change `return { ok: false, reason: \`quote check failed: ...` to `return { ok: true, reply };`; the quote-check test FAILS and so do existing `respond()` rejection tests; restore.

- [ ] **Step 6: Commit**

```bash
git add src/responder.js test/responder.test.js
git commit -m "feat(responder): respondWithReason carries the cause of a dropped reply"
```

---

### Task 9: The lean judge (draft prompt)

**Files:**
- Create: `src/addressee.js`
- Test: `test/addressee.test.js`

**Interfaces:**
- Consumes: `stripThinking` (`src/responder.js`), `withTimeout` (Task 2), Entry shape (Task 4), `config.llm.addresseeModel`, `config.trigger.addresseeTimeoutSeconds`.
- Produces:
  - `ADDRESSEE_SYSTEM: string`
  - `buildAddresseeMessages({ entries }) → [{ role: 'system', ... }, { role: 'user', content: 'name: text\n...' }]` — Lu's lines are named `Lu`.
  - `parseAddresseeAnswer(raw) → { yes: boolean, reason: string }`
  - `isAddressedToLu({ entries, llm, config, available = true, setTimeoutImpl?, clearTimeoutImpl? }) → Promise<{ yes: boolean, reason: string }>` — never throws.
  - `hasModel(ids: string[], name: string) → boolean` — exact match, or `name:latest` when `name` has no tag.

The prompt here is a **draft**. Task 10 measures it and may revise `ADDRESSEE_SYSTEM`; tests below deliberately assert properties of the prompt, not its exact wording, so a measured revision does not need test surgery.

- [ ] **Step 1: Write the failing tests** — create `test/addressee.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/addressee.test.js`
Expected: FAIL — `Cannot find module '../src/addressee.js'`.

- [ ] **Step 3: Implement** — create `src/addressee.js`:

```js
import { stripThinking } from './responder.js';
import { withTimeout } from './timeout.js';

// Kept deliberately short: on the mini's CPU almost all of this call's cost is
// reading the prompt, not writing the one-word answer. DRAFT — finalised by
// the measuring step (plan Task 10).
export const ADDRESSEE_SYSTEM =
  'You read the end of a Discord chat. Lu is a bot in it. ' +
  'Answer YES if the last message is meant for Lu, NO if it is not. One word.';

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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Mutation check** — change `/^\W*(yes|no)\b/i` to `/(yes|no)/i`; the "I think yes" / "yesterday" case FAILS; restore.

- [ ] **Step 6: Commit**

```bash
git add src/addressee.js test/addressee.test.js
git commit -m "feat(addressee): lean is-this-for-Lu judge with a draft prompt"
```

---

### Task 10: Measuring step (on the mini)

Throwaway investigation. Nothing here is committed except the prompt/model outcome and a decision-log entry.

**Preconditions — stop and report if either fails:**
- `ssh mini true` succeeds. If not, report "measuring step blocked: mini unreachable", leave `LLM_ADDRESSEE_MODEL` unset (the judge uses `qwen3:4b-instruct`, already installed there), and continue with Task 11. The spec allows this: the judge follows later.
- **Ask the user** before pulling `qwen3:1.7b` (≈1.4GB) on the mini. If they decline, measure `qwen3:4b-instruct` alone.

**Files (gitignored, under `.superpowers/`):**
- Create: `.superpowers/sdd/2026-09-11-old-lu-stage1/addressee-examples.json`
- Create: `.superpowers/sdd/2026-09-11-old-lu-stage1/measure-addressee.mjs`
- Create: `.superpowers/sdd/2026-09-11-old-lu-stage1/measurement.md`

- [ ] **Step 1: Write the examples.** 40 made-up conversations — not real chat — in this shape, 20 labelled `lu` and 20 `not`, each 3-6 lines with at least one Lu line within the last 8 (they model rule 6's window). Cover: follow-up questions to Lu without his name ("and why is that"), disagreement with Lu, two humans chatting past Lu, a human answering another human's question, a human asking the room, banter not aimed at anyone, a short reaction ("lol").

```json
[
  { "label": "lu", "entries": [
    { "name": "Lu", "isLu": true, "text": "the state is a tool of class rule" },
    { "name": "sam", "isLu": false, "text": "a tool for what exactly" } ] },
  { "label": "not", "entries": [
    { "name": "Lu", "isLu": true, "text": "the state is a tool of class rule" },
    { "name": "sam", "isLu": false, "text": "ana are you coming to training tonight" } ] }
]
```

Show the user the list with labels and offer to let them correct labels before measuring.

- [ ] **Step 2: Write the script** — `.superpowers/sdd/2026-09-11-old-lu-stage1/measure-addressee.mjs`:

```js
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLlm } from '../../../src/llm.js';
import { isAddressedToLu } from '../../../src/addressee.js';

const here = import.meta.dirname;
const examples = JSON.parse(await readFile(join(here, 'addressee-examples.json'), 'utf8'));
const models = process.argv.slice(2);
const llm = createLlm({ baseUrl: 'http://127.0.0.1:11434/v1' });

for (const model of models) {
  // Warm the model so the first timing is not a load time.
  await isAddressedToLu({ entries: examples[0].entries, llm, config: { llm: { addresseeModel: model }, trigger: { addresseeTimeoutSeconds: 120 } } });
  const times = [];
  let falseYes = 0; let falseNo = 0; let unclear = 0;
  for (const ex of examples) {
    const t0 = performance.now();
    const out = await isAddressedToLu({ entries: ex.entries, llm, config: { llm: { addresseeModel: model }, trigger: { addresseeTimeoutSeconds: 120 } } });
    times.push(performance.now() - t0);
    if (out.reason === 'unclear answer') unclear++;
    if (out.yes && ex.label === 'not') falseYes++;
    if (!out.yes && ex.label === 'lu') falseNo++;
  }
  times.sort((a, b) => a - b);
  const pct = (p) => (times[Math.floor(p * (times.length - 1))] / 1000).toFixed(2);
  console.log(`${model}: answered-when-shouldnt=${falseYes} silent-when-should=${falseNo} unclear=${unclear} of ${examples.length}; median=${pct(0.5)}s p90=${pct(0.9)}s`);
}
```

- [ ] **Step 3: Copy to the mini, separate from the running bot**

```bash
rsync -a --delete --exclude .git --exclude node_modules --exclude .env ./ mini:lu-bot-measure/
```

(`~/lu-bot` on the mini is the live deployment; this never touches it.)

- [ ] **Step 4: Pin the model-list shape.** On the mini: `ssh mini 'curl -s http://127.0.0.1:11434/v1/models'`. Confirm the response is `{ "object": "list", "data": [ { "id": ... } ] }` as asserted in Task 2's `listModels` test. If the shape differs, fix the test fixture and `listModels` to the real shape (test first), and note it in `measurement.md`.

- [ ] **Step 5: Run accuracy and speed**

```bash
ssh mini 'cd ~/lu-bot-measure && PATH=/Users/jackcurphey/node/bin:$PATH node .superpowers/sdd/2026-09-11-old-lu-stage1/measure-addressee.mjs qwen3:4b-instruct qwen3:1.7b'
```

- [ ] **Step 6: Check prompt reuse between replies.** Using Ollama's native API on the mini (`/api/chat`, `"stream": false`), send in order: (A) persona + 15 history turns + a message; (B) the addressee prompt on the same model; (C) request A plus one more turn. Record each response's `prompt_eval_count` and `prompt_eval_duration`. If C's `prompt_eval_count` is close to A's, B evicted A's cached text — a point in favour of a separate judge model. Repeat with B on `qwen3:1.7b`.

- [ ] **Step 7: Revise the prompt only if it is the problem.** If either model has more than 6 of 40 wrong or any `unclear`, revise `ADDRESSEE_SYSTEM` (keep ≤300 chars) and re-run Step 5. At most 3 revisions; then stop and report the numbers as they are. Any revision goes back through `npm test`.

- [ ] **Step 8: Write `measurement.md`** with: raw output of Steps 4-6, the prompt measured, and a recommendation. Recommend `qwen3:1.7b` only if its total mistakes are no more than 2 above `qwen3:4b-instruct`'s **and** its median time is at least 30% lower; otherwise recommend `qwen3:4b-instruct`. **Present the numbers and recommendation to the user; the user picks.**

- [ ] **Step 9: Apply the choice and commit**

In `.env.example`, set the commented line to the chosen model, e.g. `LLM_ADDRESSEE_MODEL=qwen3:1.7b` (uncommented) — or leave it commented if the choice is `qwen3:4b-instruct`. Add a row to the spec's decision log with the measured numbers. If `ADDRESSEE_SYSTEM` changed, remove the `DRAFT` sentence from its comment.

```bash
npm test
git add .env.example src/addressee.js docs/superpowers/specs/2026-09-11-old-lu-stage1-design.md
git commit -m "chore(addressee): judge model and prompt chosen by measurement on the mini"
```

---

### Task 11: Discord adapter

**Files:**
- Modify: `src/discord.js:1-8` (replace `shouldHandle`), `src/discord.js:65-110` (replace `startBot`)
- Test: `test/discord.test.js`

**Interfaces:**
- Produces:
  - View shape (built by the adapter from a discord.js `Message`; plain data):
    `{ id, channelId, author: { id, bot, displayName }, content, mentionedUsers: [{ id, displayName }], repliedUserId: string|null, createdTimestamp }`
  - `shouldObserve(view, { botId, allowedChannels }) → boolean` — false for Lu's own messages and disallowed channels; true for everything else, other bots included.
  - `LU_NAME = 'Lu'`
  - `toEntry(view, { botId }) → Entry` — user mention tags become `@displayName` (`@Lu` for the bot, `@someone` when unknown); role/channel tags untouched; text trimmed.
  - `createChannelIo(channel) → { send(text): Promise<string|null> /* message id */, startTyping(): { stop() } }` — posts with `channel.send({ content, allowedMentions: { parse: [] } })`.
  - `startBot({ config, onMessage: (entry, io) => Promise<void> }) → Promise<Client>`

- [ ] **Step 1: Write the failing tests** — in `test/discord.test.js`:

Change the import on line 3 to:

```js
import { shouldObserve, toEntry, createChannelIo, LU_NAME, truncateForDiscord, DISCORD_REPLY_LIMIT, startTyping, TYPING_REFRESH_MS } from '../src/discord.js';
```

Delete the six `shouldHandle` tests and the `opts`/`base` constants above them (lines 5-30): Lu no longer only handles mentions, so "ignores messages that do not mention it" is now wrong by design. Replace them with:

```js
// --- Old Lu stage 1: hear everything in allowed channels ------------------------
//
// Lu follows the conversation, so the adapter passes on every message in an
// allowed channel — other bots included (they are heard, never answered; that
// rule lives in attention.js). Only his own messages and other channels are
// dropped here.

const opts = { botId: 'bot', allowedChannels: ['chan'] };
const view = (over = {}) => ({
  id: 'm1', channelId: 'chan', author: { id: 'human', bot: false, displayName: 'sam' },
  content: 'hello', mentionedUsers: [], repliedUserId: null, createdTimestamp: 1000, ...over,
});

test('observes a human message in an allowed channel, mention or not', () => {
  assert.equal(shouldObserve(view(), opts), true);
});

test('observes other bots, so their messages reach history', () => {
  assert.equal(shouldObserve(view({ author: { id: 'b2', bot: true, displayName: 'b2' } }), opts), true);
});

test('drops its own messages', () => {
  assert.equal(shouldObserve(view({ author: { id: 'bot', bot: true, displayName: 'Lu' } }), opts), false);
});

test('drops channels not on the allowlist, and an empty allowlist permits none', () => {
  assert.equal(shouldObserve(view({ channelId: 'other' }), opts), false);
  assert.equal(shouldObserve(view(), { ...opts, allowedChannels: [] }), false);
});

test('toEntry maps the view to an entry', () => {
  assert.deepEqual(toEntry(view({ repliedUserId: 'ana' }), { botId: 'bot' }), {
    messageId: 'm1', channelId: 'chan', authorId: 'human', name: 'sam',
    isBot: false, isLu: false, mentionsLu: false, mentionsOthers: false,
    repliesToLu: false, repliesToOther: true, at: 1000, text: 'hello',
  });
});

// Open bug in .agents/STATUS.md: stripping the mention tag left a bare "@Lu"
// message empty, and the model server rejects empty content with HTTP 400.
test('a bare mention of Lu becomes "@Lu", never empty text', () => {
  const entry = toEntry(view({ content: '<@bot>', mentionedUsers: [{ id: 'bot', displayName: 'Lu Bot' }] }), { botId: 'bot' });
  assert.equal(entry.text, `@${LU_NAME}`);
  assert.equal(entry.mentionsLu, true);
});

test('other user mentions become @displayName; unknown ones @someone', () => {
  const entry = toEntry(view({
    content: 'ask <@!ana> or <@999> in <#123>',
    mentionedUsers: [{ id: 'ana', displayName: 'ana' }],
  }), { botId: 'bot' });
  assert.equal(entry.text, 'ask @ana or @someone in <#123>');
  assert.equal(entry.mentionsOthers, true);
  assert.equal(entry.mentionsLu, false);
});

test('a reply to Lu is flagged as such', () => {
  const entry = toEntry(view({ repliedUserId: 'bot' }), { botId: 'bot' });
  assert.equal(entry.repliesToLu, true);
  assert.equal(entry.repliesToOther, false);
});

test('Lu posts as a plain channel message that pings nobody, never as a reply', async () => {
  const calls = [];
  const channel = {
    async send(payload) { calls.push(['send', payload]); return { id: 'new1' }; },
    async reply() { calls.push(['reply']); },
    sendTyping: async () => {},
  };
  const id = await createChannelIo(channel).send('wot');
  assert.equal(id, 'new1');
  assert.deepEqual(calls, [['send', { content: 'wot', allowedMentions: { parse: [] } }]]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/discord.test.js`
Expected: FAIL — `shouldObserve` / `toEntry` / `createChannelIo` / `LU_NAME` not exported.

- [ ] **Step 3: Implement** — in `src/discord.js`:

Replace lines 3-8 (`shouldHandle`) with:

```js
// Every message in an allowed channel is passed on, so Lu can follow the
// conversation. Whether he answers is decided later, in attention.js.
export function shouldObserve(view, { botId, allowedChannels }) {
  if (view.author.id === botId) return false;
  return allowedChannels.includes(view.channelId);
}

export const LU_NAME = 'Lu';

export function toEntry(view, { botId }) {
  const names = new Map(view.mentionedUsers.map((u) => [u.id, u.displayName]));
  // Mention tags are rendered, not deleted: deleting them left a bare "@Lu"
  // message empty, which the model server rejects with HTTP 400.
  const text = view.content
    .replace(/<@!?(\d+|[A-Za-z0-9_-]+)>/g, (_, id) => `@${id === botId ? LU_NAME : (names.get(id) ?? 'someone')}`)
    .trim();
  const mentionedIds = view.mentionedUsers.map((u) => u.id);

  return {
    messageId: view.id,
    channelId: view.channelId,
    authorId: view.author.id,
    name: view.author.displayName,
    isBot: view.author.bot,
    isLu: view.author.id === botId,
    mentionsLu: mentionedIds.includes(botId),
    mentionsOthers: mentionedIds.some((id) => id !== botId),
    repliesToLu: view.repliedUserId === botId,
    repliesToOther: view.repliedUserId != null && view.repliedUserId !== botId,
    at: view.createdTimestamp,
    text,
  };
}

export function createChannelIo(channel) {
  return {
    // A plain message, not a Discord reply (user's choice), and one that can
    // never ping @everyone or a user whatever the model writes.
    async send(text) {
      const sent = await channel.send({ content: text, allowedMentions: { parse: [] } });
      return sent?.id ?? null;
    },
    startTyping: () => startTyping({ channel }),
  };
}
```

(The tag regex accepts non-numeric IDs only so tests can use readable IDs like `bot`; real Discord IDs are numeric and match either way.)

Replace `startBot` (lines 65-110) with:

```js
function viewOf(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author.id,
      bot: message.author.bot,
      displayName: message.member?.displayName ?? message.author.displayName,
    },
    content: message.content,
    mentionedUsers: [...message.mentions.users.values()].map((u) => ({
      id: u.id,
      displayName: message.mentions.members?.get(u.id)?.displayName ?? u.displayName,
    })),
    repliedUserId: message.mentions.repliedUser?.id ?? null,
    createdTimestamp: message.createdTimestamp,
  };
}

export async function startBot({ config, onMessage }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Client is an EventEmitter, and an 'error' event with no listener is
  // re-thrown by Node and kills the process. A routine gateway hiccup would
  // otherwise take the bot down silently. Logging only — no reconnection
  // logic here; discord.js does its own, and anything beyond that is a
  // process manager's job.
  client.on(Events.Error, (err) => {
    console.error('Discord client error:', err);
  });

  client.on(Events.MessageCreate, async (message) => {
    const view = viewOf(message);
    if (!shouldObserve(view, { botId: client.user.id, allowedChannels: config.discord.allowedChannels })) {
      return;
    }
    try {
      await onMessage(toEntry(view, { botId: client.user.id }), createChannelIo(message.channel));
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  });

  await client.login(config.discord.token);
  return client;
}
```

- [ ] **Step 4: Run** — `npm test -- test/discord.test.js` passes. `src/index.js` still calls `startBot({ config, onMention })` and is fixed in Task 12; `npm test` does not import `index.js`, so the full suite passes. Run `npm test`.
Expected: all pass.

- [ ] **Step 5: Mutation check** — in `createChannelIo`, change `channel.send(...)` to `channel.reply(...)`; the plain-message test FAILS; restore. In `toEntry`, change the replacer to return `''`; the bare-mention test FAILS; restore.

- [ ] **Step 6: Commit**

```bash
git add src/discord.js test/discord.test.js
git commit -m "feat(discord): hear every message, post plain messages, fix bare @Lu"
```

---

### Task 12: Conversation orchestrator and wiring

**Files:**
- Create: `src/conversation.js`
- Modify: `src/index.js` (full rewrite below)
- Test: `test/conversation.test.js`

**Interfaces:**
- Consumes: `decide` (Task 5), `createPauser` (Task 6), `toChatTurns` (Task 4), `EXPLAIN_RE`/`NOT_FOUND`/`formatDecision` (Task 7), `withTimeout`/`TimeoutError` (Task 2), `truncateForDiscord` (existing), and injected: `history` (Task 4), `decisions` (Task 7), `respondWithReason` (Task 8), `isAddressed({ entries }) → { yes, reason }` (Task 9, bound in index), `chooseChunks(text) → chunks[]`, io from `createChannelIo` (Task 11).
- Produces:
  - `HEADACHE = 'uh oh... i have a headache'`
  - `createConversation({ config, history, decisions, persona, llm, chooseChunks, respondWithReason, isAddressed, now?, random?, setTimeoutImpl?, clearTimeoutImpl? }) → { handleMessage(entry, io): Promise<void>, idle(channelId): Promise<void> }`

- [ ] **Step 1: Write the failing tests** — create `test/conversation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, HEADACHE } from '../src/conversation.js';
import { createHistory } from '../src/history.js';
import { createDecisionLog, NOT_FOUND } from '../src/decisions.js';

const config = {
  trigger: {
    keywords: ['lu', 'ai bot'], randomReplyChance: 0.02, cooldownSeconds: 60, windowMessages: 8,
    windowMinutes: 5, pauseSeconds: 3, enabled: true, maxQuoteChars: 400, addresseeTimeoutSeconds: 15,
  },
  reply: { timeoutSeconds: 90 },
  llm: { chatModel: 'chat' },
};
const T0 = 1_000_000;
const PAUSE_MS = 3000;
const REPLY_MS = 90_000;

// Timers are fired by duration, so the pause and the reply timeout can be
// driven separately.
function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutImpl: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeoutImpl: (id) => { timers.delete(id); },
    fire(ms) {
      for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); }
    },
    count: (ms) => [...timers.values()].filter((t) => t.ms === ms).length,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

let seq = 0;
function msg(over = {}) {
  seq++;
  return {
    messageId: `m${seq}`, channelId: 'chan', authorId: 'sam', name: 'sam', isBot: false, isLu: false,
    mentionsLu: false, mentionsOthers: false, repliesToLu: false, repliesToOther: false,
    at: T0, text: 'hello', ...over,
  };
}
const luSaid = (text = 'the state is a tool') => msg({ authorId: 'lu', name: 'Lu', isLu: true, isBot: true, text });

function setup(over = {}) {
  const timers = fakeTimers();
  const history = createHistory({ limit: 20, trimTo: 10 });
  const decisions = createDecisionLog();
  const calls = { respond: [], judge: [] };
  const sent = [];
  let typingStarts = 0; let typingStops = 0;
  const io = {
    async send(text) { sent.push(text); return `sent${sent.length}`; },
    startTyping() { typingStarts++; return { stop() { typingStops++; } }; },
  };
  const conversation = createConversation({
    config, history, decisions, persona: 'P', llm: {},
    chooseChunks: async () => [],
    respondWithReason: async (args) => { calls.respond.push(args); return { ok: true, reply: 'wot' }; },
    isAddressed: async ({ entries }) => { calls.judge.push(entries); return { yes: true, reason: '' }; },
    now: () => T0,
    random: () => 0.99,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    ...over,
  });
  // Lu's earlier lines are seeded straight into history, as if he had sent them.
  const seedLu = (text) => history.record(luSaid(text));
  const typing = () => ({ typingStarts, typingStops });
  return { conversation, history, decisions, calls, sent, io, timers, seedLu, typing };
}

async function say(s, entry) {
  await s.conversation.handleMessage(entry, s.io);
  await s.conversation.idle(entry.channelId);
}

// --- Direct address ------------------------------------------------------------

test('a mention is answered with a plain message, and his reply joins history', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true, text: '@Lu hi' }));
  assert.deepEqual(s.sent, ['wot']);
  const last = s.history.entries('chan').at(-1);
  assert.equal(last.isLu, true);
  assert.equal(last.text, 'wot');
  assert.equal(last.messageId, 'sent1');
});

test('the prompt carries the named conversation before the message being answered', async () => {
  const s = setup();
  await say(s, msg({ name: 'ana', text: 'taiwan is interesting' }));
  await say(s, msg({ mentionsLu: true, text: '@Lu what do you think' }));
  const args = s.calls.respond[0];
  assert.equal(args.message, 'sam: @Lu what do you think');
  assert.deepEqual(args.history, [{ role: 'user', content: 'ana: taiwan is interesting' }]);
  assert.equal(args.persona, 'P');
});

test('people talking without him get silence, and no model call at all', async () => {
  const s = setup();
  await say(s, msg({ text: 'training tonight?' }));
  await say(s, msg({ name: 'ana', text: 'yeah 7pm' }));
  assert.deepEqual(s.sent, []);
  assert.equal(s.calls.respond.length, 0);
  assert.equal(s.calls.judge.length, 0);
});

test('other bots are heard but never answered', async () => {
  const s = setup();
  await say(s, msg({ isBot: true, name: 'otherbot', mentionsLu: true, text: '@Lu beep' }));
  assert.deepEqual(s.sent, []);
  assert.equal(s.history.entries('chan').length, 1);
});

test('his own Discord events are not recorded a second time', async () => {
  const s = setup();
  await say(s, luSaid('i said this'));
  assert.equal(s.history.entries('chan').length, 0);
});

test('a message with no text is not recorded', async () => {
  const s = setup();
  await say(s, msg({ text: '' }));
  assert.equal(s.history.entries('chan').length, 0);
});

test('typing stops after a reply', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true }));
  assert.deepEqual(s.typing(), { typingStarts: 1, typingStops: 1 });
});

// --- Following the conversation ------------------------------------------------

test('a follow-up while he is in the conversation is judged after the pause', async () => {
  const s = setup();
  s.seedLu();
  await s.conversation.handleMessage(msg({ text: 'a tool for what exactly' }), s.io);
  assert.equal(s.calls.judge.length, 0, 'judged before the pause ended');
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.equal(s.calls.judge.length, 1);
  assert.equal(s.calls.judge[0].at(-1).text, 'a tool for what exactly');
  assert.deepEqual(s.sent, ['wot']);
});

test('a judge NO means silence, and the log says so', async () => {
  const s = setup({ isAddressed: async () => ({ yes: false, reason: '' }) });
  s.seedLu();
  const m = msg({ text: 'ana did you see the match' });
  await s.conversation.handleMessage(m, s.io);
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.deepEqual(s.sent, []);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('judge said NO'));
});

test('a burst of messages costs one judge call, for the latest', async () => {
  const s = setup();
  s.seedLu();
  for (const text of ['wait', 'so what you are saying', 'is that the state serves one class']) {
    await s.conversation.handleMessage(msg({ text }), s.io);
  }
  s.timers.fire(PAUSE_MS);
  await s.conversation.idle('chan');
  assert.equal(s.calls.judge.length, 1);
  assert.equal(s.calls.judge[0].at(-1).text, 'is that the state serves one class');
});

test('direct address during a pause is answered at once and the judge is skipped', async () => {
  const s = setup();
  s.seedLu();
  await s.conversation.handleMessage(msg({ text: 'hmm' }), s.io);
  await say(s, msg({ mentionsLu: true, text: '@Lu answer me' }));
  assert.equal(s.timers.count(PAUSE_MS), 0);
  assert.equal(s.calls.judge.length, 0);
  assert.deepEqual(s.sent, ['wot']);
});

// --- Failures and the headache signal ------------------------------------------

test('a failed reply to a mention posts the headache, not the error', async () => {
  const s = setup({ respondWithReason: async () => ({ ok: false, reason: 'empty reply after stripping reasoning' }) });
  const m = msg({ mentionsLu: true });
  await say(s, m);
  assert.deepEqual(s.sent, [HEADACHE]);
  assert.equal(HEADACHE, 'uh oh... i have a headache');
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('reply failed: empty reply after stripping reasoning'));
  assert.equal(s.history.entries('chan').some((e) => e.isLu), false, 'the headache must not enter history');
});

test('a model server error on a mention posts the headache and logs the cause', async () => {
  const s = setup({ respondWithReason: async () => { throw new Error('Model server request to /chat/completions failed with status 500'); } });
  const m = msg({ mentionsLu: true });
  await say(s, m);
  assert.deepEqual(s.sent, [HEADACHE]);
  assert.match(s.decisions.find('chan', m.messageId).reasons.at(-1), /^reply failed: model server error: .*500/);
  assert.deepEqual(s.typing(), { typingStarts: 1, typingStops: 1 });
});

test('a reply that takes too long posts the headache', async () => {
  const s = setup({ respondWithReason: () => new Promise(() => {}) });
  const m = msg({ mentionsLu: true });
  await s.conversation.handleMessage(m, s.io);
  await tick();
  s.timers.fire(REPLY_MS);
  await s.conversation.idle('chan');
  assert.deepEqual(s.sent, [HEADACHE]);
  assert.ok(s.decisions.find('chan', m.messageId).reasons.includes('reply failed: reply timed out after 90s'));
});

test('a failed random chime-in stays silent', async () => {
  const s = setup({ random: () => 0, respondWithReason: async () => ({ ok: false, reason: 'empty reply after stripping reasoning' }) });
  await say(s, msg({ text: 'anyone up' }));
  assert.deepEqual(s.sent, []);
});

test('a chime-in starts the cooldown for the next one', async () => {
  const s = setup({ random: () => 0, respondWithReason: async (args) => { s.calls.respond.push(args); return { ok: false, reason: 'x' }; } });
  await say(s, msg({ text: 'anyone up' }));
  await say(s, msg({ text: 'hello?' }));
  assert.equal(s.calls.respond.length, 1);
});

// --- lu explain ----------------------------------------------------------------

test('lu explain reports the latest decision and is not itself answered or recorded', async () => {
  const s = setup();
  await say(s, msg({ mentionsLu: true, text: '@Lu hi' }));
  await say(s, msg({ text: 'lu explain' }));
  assert.equal(s.calls.respond.length, 1);
  assert.match(s.sent[1], /^I replied to sam's message/);
  assert.match(s.sent[1], /i was @mentioned/);
  assert.equal(s.history.entries('chan').some((e) => e.text === 'lu explain'), false);
});

test('lu explain with nothing recorded says it has no record', async () => {
  const s = setup();
  await say(s, msg({ text: 'lu explain' }));
  assert.deepEqual(s.sent, [NOT_FOUND]);
});

// --- One reply at a time -------------------------------------------------------

test('while busy, only the latest waiting message is handled afterwards', async () => {
  const gates = [];
  const s = setup({
    respondWithReason: (args) => {
      s.calls.respond.push(args);
      return new Promise((resolve) => gates.push(() => resolve({ ok: true, reply: 'wot' })));
    },
  });
  const a = msg({ mentionsLu: true, text: '@Lu one' });
  const b = msg({ mentionsLu: true, text: '@Lu two' });
  const c = msg({ mentionsLu: true, text: '@Lu three' });
  await s.conversation.handleMessage(a, s.io);
  await s.conversation.handleMessage(b, s.io);
  await s.conversation.handleMessage(c, s.io);
  await tick();
  assert.equal(gates.length, 1);
  gates[0]();
  await tick(); await tick();
  assert.equal(gates.length, 2);
  gates[1]();
  await s.conversation.idle('chan');
  assert.deepEqual(s.calls.respond.map((r) => r.message), ['sam: @Lu one', 'sam: @Lu three']);
  assert.ok(s.decisions.find('chan', b.messageId).reasons.some((r) => r.startsWith('skipped')));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/conversation.test.js`
Expected: FAIL — `Cannot find module '../src/conversation.js'`.

- [ ] **Step 3: Implement** — create `src/conversation.js`:

```js
import { decide } from './attention.js';
import { createPauser } from './pause.js';
import { toChatTurns } from './history.js';
import { EXPLAIN_RE, NOT_FOUND, formatDecision } from './decisions.js';
import { withTimeout, TimeoutError } from './timeout.js';
import { truncateForDiscord } from './discord.js';

// In character, and fixed, so the group reads it as "something broke" while
// anyone else just sees Lu having a bad moment. The real cause is in the
// decision log, for "lu explain".
export const HEADACHE = 'uh oh... i have a headache';

export function createConversation({
  config,
  history,
  decisions,
  persona,
  llm,
  chooseChunks,
  respondWithReason,
  isAddressed,
  now = Date.now,
  random = Math.random,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const channels = new Map();

  function channel(id) {
    let c = channels.get(id);
    if (!c) {
      c = { io: null, lastChimeAt: null, busy: false, pending: null, idle: Promise.resolve() };
      channels.set(id, c);
    }
    return c;
  }

  function note(channelId, entry, reason) {
    decisions.find(channelId, entry.messageId)?.reasons.push(reason);
  }

  const pauser = createPauser({
    ms: config.trigger.pauseSeconds * 1000,
    onSettled: (channelId, entry) => { enqueue(channelId, { entry, kind: 'judge' }); },
    setTimeoutImpl,
    clearTimeoutImpl,
  });

  async function safeSend(state, text) {
    try {
      return await state.io.send(truncateForDiscord(text));
    } catch (err) {
      console.error('Failed to post to Discord:', err);
      return null;
    }
  }

  function split(channelId, entry) {
    const entries = history.entries(channelId);
    const i = entries.findIndex((e) => e.messageId === entry.messageId);
    return i === -1
      ? { prior: [], upTo: [entry] }
      : { prior: entries.slice(0, i), upTo: entries.slice(0, i + 1) };
  }

  // One reply per channel at a time. While busy, only the newest waiting job
  // is kept; older ones are skipped and the log says why.
  function enqueue(channelId, job) {
    const state = channel(channelId);
    if (state.busy) {
      if (state.pending) note(channelId, state.pending.entry, 'skipped: a newer message came in while i was busy');
      state.pending = job;
      return;
    }
    state.busy = true;
    state.idle = (async () => {
      let next = job;
      while (next) {
        await run(channelId, next);
        next = state.pending;
        state.pending = null;
      }
      state.busy = false;
    })().catch((err) => {
      state.busy = false;
      console.error('Conversation worker failed:', err);
    });
  }

  async function run(channelId, { entry, kind }) {
    const rec = decisions.find(channelId, entry.messageId);
    if (kind === 'judge') {
      const verdict = await isAddressed({ entries: split(channelId, entry).upTo.slice(-6) });
      rec?.reasons.push(`judge said ${verdict.yes ? 'YES' : 'NO'}${verdict.reason ? ` (${verdict.reason})` : ''}`);
      if (!verdict.yes) {
        if (rec) rec.outcome = 'ignore';
        return;
      }
      if (rec) rec.outcome = 'reply';
    }
    await reply(channelId, entry, { direct: kind !== 'chime' }, rec);
  }

  async function reply(channelId, entry, { direct }, rec) {
    const state = channel(channelId);
    const typing = state.io.startTyping();
    const fail = async (reason) => {
      rec?.reasons.push(`reply failed: ${reason}`);
      // Nobody asked for a random chime-in, so a failed one stays silent.
      if (direct) await safeSend(state, HEADACHE);
    };

    try {
      let result;
      try {
        const { prior } = split(channelId, entry);
        result = await withTimeout(async (signal) => {
          const chunks = await chooseChunks(entry.text);
          return respondWithReason({
            message: `${entry.name}: ${entry.text}`,
            chunks,
            history: toChatTurns(prior),
            persona,
            llm,
            config,
            signal,
          });
        }, config.reply.timeoutSeconds * 1000, { setTimeoutImpl, clearTimeoutImpl });
      } catch (err) {
        await fail(err instanceof TimeoutError
          ? `reply timed out after ${config.reply.timeoutSeconds}s`
          : `model server error: ${err.message}`);
        return;
      }

      if (!result.ok) {
        await fail(result.reason);
        return;
      }

      const text = truncateForDiscord(result.reply);
      const id = await safeSend(state, text);
      if (id === null) {
        rec?.reasons.push('reply failed: discord would not take the message');
        return;
      }
      history.record({
        messageId: id, channelId, authorId: 'lu', name: 'Lu', isBot: true, isLu: true,
        mentionsLu: false, mentionsOthers: false, repliesToLu: false, repliesToOther: false,
        at: now(), text,
      });
      if (rec) {
        rec.sent = text;
        rec.reasons.push('replied');
      }
    } finally {
      // finally: a dropped reply and a thrown error must both stop the indicator.
      typing.stop();
    }
  }

  async function handleMessage(entry, io) {
    if (entry.isLu || !entry.text) return;
    const state = channel(entry.channelId);
    state.io = io;

    const explain = entry.isBot ? null : EXPLAIN_RE.exec(entry.text);
    if (explain) {
      const rec = decisions.find(entry.channelId, explain[1]);
      await safeSend(state, rec ? formatDecision(rec) : NOT_FOUND);
      return;
    }

    history.record(entry);
    const decision = decide({
      entry,
      history: history.entries(entry.channelId),
      state: { lastChimeAt: state.lastChimeAt },
      now: now(),
      config,
      random,
    });
    decisions.record(entry.channelId, {
      messageId: entry.messageId,
      authorName: entry.name,
      outcome: decision.outcome,
      reasons: [...decision.reasons],
      sent: null,
    });

    if (decision.outcome === 'ask-judge') {
      note(entry.channelId, entry, `waiting ${config.trigger.pauseSeconds}s for a pause before asking the judge`);
      const replaced = pauser.wait(entry.channelId, entry);
      if (replaced) note(entry.channelId, replaced, 'judge skipped: a newer message came in during the pause');
      return;
    }

    // Anything else ends a pending pause: the latest message is either aimed
    // at Lu directly (answered below) or not for him at all.
    const cancelled = pauser.cancel(entry.channelId);
    if (cancelled) note(entry.channelId, cancelled, 'judge skipped: the conversation moved on during the pause');

    if (decision.outcome === 'ignore') return;
    if (decision.trigger === 'chime') state.lastChimeAt = now();
    enqueue(entry.channelId, { entry, kind: decision.trigger === 'chime' ? 'chime' : 'direct' });
  }

  return {
    handleMessage,
    idle: (channelId) => channel(channelId).idle,
  };
}
```

Replace `src/index.js` entirely with:

```js
import { join } from 'node:path';

import { loadConfig, startupWarnings } from './config.js';
import { createLlm } from './llm.js';
import { loadPersona } from './persona.js';
import { respondWithReason } from './responder.js';
import { loadCorpus, search } from './corpus/store.js';
import { shouldUseCorpus } from './judge.js';
import { startBot } from './discord.js';
import { createHistory } from './history.js';
import { createDecisionLog } from './decisions.js';
import { isAddressedToLu, hasModel } from './addressee.js';
import { createConversation } from './conversation.js';

// A rejected promise with no handler is fatal in Node. The bot is meant to sit
// in a channel for weeks; one unhandled rejection in a background path should
// not end that silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const config = loadConfig(process.env);

for (const warning of startupWarnings(config)) {
  console.warn(`WARNING: ${warning}`);
}

const llm = createLlm({ baseUrl: config.llm.baseUrl });
// Resolved against this module, not the process working directory: under
// launchd, systemd or pm2 — how this is actually run — cwd is not the repo
// root and a relative path here is an ENOENT crash at startup.
const projectRoot = join(import.meta.dirname, '..');
const persona = await loadPersona(join(projectRoot, 'persona', 'lu-bot.md'));
const corpus = await loadCorpus(join(projectRoot, 'data', 'corpus'));

console.log(
  corpus.size > 0
    ? `Loaded ${corpus.size} chunks (${corpus.dim} dimensions).`
    : 'No corpus found. Running persona-only.',
);

// A missing judge model would otherwise surface as a 404 on every judge call.
// Treat it as "never aimed at me" and say so once, at startup; direct address
// keeps working.
let addresseeAvailable = true;
try {
  addresseeAvailable = hasModel(await llm.listModels(), config.llm.addresseeModel);
  if (!addresseeAvailable) {
    console.warn(
      `WARNING: judge model ${config.llm.addresseeModel} is not installed on the model server; ` +
      'Lu will only answer @mentions, replies to him and his name.',
    );
  }
} catch (err) {
  console.warn(`WARNING: could not list installed models (${err.message}); assuming ${config.llm.addresseeModel} is there.`);
}

async function retrieve(content) {
  if (corpus.size === 0) return [];
  const [vector] = await llm.embed({ model: config.llm.embedModel, input: [content] });
  return search(corpus, vector, 5)
    .filter((hit) => hit.score >= config.trigger.similarityFloor)
    .map((hit) => hit.chunk);
}

const conversation = createConversation({
  config,
  history: createHistory(config.history),
  decisions: createDecisionLog(),
  persona,
  llm,
  // Retrieval finds candidates; the corpus judge decides whether they earn a
  // place in the prompt. A model handed passages tends to quote them.
  async chooseChunks(text) {
    const candidates = await retrieve(text);
    return (await shouldUseCorpus({ message: text, chunks: candidates, llm, config })) ? candidates : [];
  },
  respondWithReason,
  isAddressed: ({ entries }) => isAddressedToLu({ entries, llm, config, available: addresseeAvailable }),
});

await startBot({
  config,
  onMessage: (entry, io) => conversation.handleMessage(entry, io),
});

console.log('Lu Bot is online.');
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all pass. Then check `index.js` at least loads its imports: `node --check src/index.js` (syntax) and `node -e "import('./src/conversation.js').then(()=>console.log('ok'))"`.

- [ ] **Step 5: Mutation checks** — each one: break, `git diff` to confirm it landed, run `npm test -- test/conversation.test.js`, confirm the named test FAILS, restore.
  - `if (direct) await safeSend(state, HEADACHE);` → `await safeSend(state, HEADACHE);` — "failed random chime-in stays silent" FAILS.
  - Delete `const cancelled = pauser.cancel(entry.channelId);` line and the one after it — "direct address during a pause" FAILS (judge called).
  - In `enqueue`, insert `return;` immediately before `state.pending = job;` — "only the latest waiting message" FAILS (the third message is never answered).
  - In `handleMessage`, move `history.record(entry);` above the explain check — "lu explain ... not recorded" FAILS.

- [ ] **Step 6: Commit**

```bash
git add src/conversation.js src/index.js test/conversation.test.js
git commit -m "feat(conversation): follow the channel, judge after a pause, headache on failure"
```

---

### Task 13: Live check, spec walk, status

Needs a running bot. Two ways; **ask the user which, before doing either**:
1. **Deploy to the mini** (the only live instance) by the existing rsync protocol in `.agents/STATUS.md` → Environment notes, then `launchctl kickstart -k gui/$(id -u)/com.curphey.lu-bot`. This replaces the running `feat/mini-deployment` build. Needs the mini reachable and awake (its sleep problem is still open).
2. **Run from this MacBook** with `npm start` against the same channel. Needs Ollama installed here (it is not — a new install, asked separately) and the mini's bot stopped meanwhile so two Lus don't answer.

- [ ] **Step 1: Run the checklist** in an allowed channel, noting pass/fail and the `lu explain` output for each:
  - a bare `@Lu` gets an answer;
  - "lu what do you think" gets an answer; "lunch anyone" does not;
  - a Discord reply to one of Lu's messages gets an answer;
  - after Lu speaks, a follow-up without his name ("and why is that") gets an answer;
  - two people talking to each other without him get silence;
  - `lu explain` gives the right reasons after a reply and after a silence;
  - his messages are plain messages, not Discord replies, and ping nobody;
  - his voice is old Lu's (lowercase, mischievous); note any quote dropped for missing quote marks (spec §1 known tension) — report it, don't patch it;
  - with the model server stopped (ask first: on the mini this takes the live bot's model down briefly), a mention gets `uh oh... i have a headache`; then restart it and confirm a normal reply.

- [ ] **Step 2: Walk the build against the spec** — every numbered section and done-condition of `docs/superpowers/specs/2026-09-11-old-lu-stage1-design.md`: met / dropped / changed, with the evidence. Add plan decisions P1-P10 (and Task 10's outcome) to the spec's decision log.

- [ ] **Step 3: Update `.agents/STATUS.md`** — stage 1 state, where it runs, live-check results, what's next (stage 2). Update `.agents/deferrals.md`: DF6 persona part addressed by stage 1; remaining old-Lu features tracked by stages 2-4.

- [ ] **Step 4: Commit**

```bash
npm test
git add docs/superpowers/specs/2026-09-11-old-lu-stage1-design.md .agents/STATUS.md .agents/deferrals.md
git commit -m "docs: stage 1 live check and spec walk"
```

Report status to the user with the evidence. Do not describe the stage as done; the user decides that.
