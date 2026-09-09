# Lu Bot Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Discord bot that replies in persona when mentioned, and draws on a
local corpus of texts when doing so adds something — with all inference running
locally through LM Studio.

**Architecture:** Four components with clean seams — a Discord adapter that
knows nothing about models, a corpus store built offline and searched in
memory, a responder that assembles the persona prompt, and a quote verifier
that mechanically rejects fabricated quotations. The corpus may be empty, in
which case the bot is a persona-only conversationalist.

**Tech Stack:** Node.js v26 (ESM), `discord.js`, LM Studio's OpenAI-compatible
HTTP endpoint via built-in `fetch`, `node:test` as the test runner. No dotenv
(Node's `--env-file`), no vector database, no OpenAI SDK.

**Spec:** `docs/superpowers/specs/2026-09-09-discord-corpus-bot-design.md`

## Global Constraints

- Node.js v26.8.1, ESM only (`"type": "module"`). No TypeScript.
- Only one runtime dependency: `discord.js`. Everything else uses Node builtins.
- Tests use `node:test` and `node:assert/strict`, run via `npm test`.
- **No test may require LM Studio to be running.** All LLM calls are injected
  and stubbed in tests.
- Secrets live only in `.env`, which is gitignored. Never commit a token.
- Embedding dimension is 768 (`nomic-embed-text-v1.5`).
- LM Studio base URL default: `http://localhost:1234/v1`.
- An empty or missing corpus is a supported state, never an error.
- Every test must be watched to fail before its implementation is written.

---

### Task 1: Project scaffolding and configuration

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(env: object) -> Config`, where `Config` is
  `{ discord: { token: string, guildId: string, allowedChannels: string[] },
  llm: { baseUrl: string, chatModel: string, judgeModel: string, embedModel: string },
  trigger: { similarityFloor: number, cooldownSeconds: number, enabled: boolean,
  maxQuoteChars: number } }`. Throws `Error` listing every missing required key.

- [ ] **Step 1: Write the failing test**

```javascript
// test/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const valid = {
  DISCORD_BOT_TOKEN: 'tok',
  DISCORD_GUILD_ID: 'guild',
  DISCORD_ALLOWED_CHANNELS: '111, 222',
  LLM_CHAT_MODEL: 'chat',
  LLM_JUDGE_MODEL: 'judge',
  LLM_EMBED_MODEL: 'embed',
};

test('parses a valid environment', () => {
  const cfg = loadConfig(valid);
  assert.equal(cfg.discord.token, 'tok');
  assert.deepEqual(cfg.discord.allowedChannels, ['111', '222']);
  assert.equal(cfg.llm.baseUrl, 'http://localhost:1234/v1');
  assert.equal(cfg.trigger.similarityFloor, 0.45);
  assert.equal(cfg.trigger.enabled, true);
});

test('lists every missing required key at once', () => {
  assert.throws(
    () => loadConfig({ DISCORD_BOT_TOKEN: 'tok' }),
    (err) => err.message.includes('DISCORD_GUILD_ID') && err.message.includes('LLM_CHAT_MODEL'),
  );
});

test('an empty channel allowlist parses to an empty array', () => {
  const cfg = loadConfig({ ...valid, DISCORD_ALLOWED_CHANNELS: '' });
  assert.deepEqual(cfg.discord.allowedChannels, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Write package.json and the minimal implementation**

```json
{
  "name": "lu-bot",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "engines": { "node": ">=26" },
  "scripts": {
    "test": "node --test",
    "start": "node --env-file=.env src/index.js",
    "ingest": "node --env-file=.env scripts/ingest.js"
  },
  "dependencies": {}
}
```

```javascript
// src/config.js
const REQUIRED = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'LLM_CHAT_MODEL',
  'LLM_JUDGE_MODEL',
  'LLM_EMBED_MODEL',
];

function num(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`${key} must be a number, got "${raw}"`);
  return parsed;
}

export function loadConfig(env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const channels = (env.DISCORD_ALLOWED_CHANNELS ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  return {
    discord: {
      token: env.DISCORD_BOT_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      allowedChannels: channels,
    },
    llm: {
      baseUrl: env.LLM_BASE_URL || 'http://localhost:1234/v1',
      chatModel: env.LLM_CHAT_MODEL,
      judgeModel: env.LLM_JUDGE_MODEL,
      embedModel: env.LLM_EMBED_MODEL,
    },
    trigger: {
      similarityFloor: num(env, 'TRIGGER_SIMILARITY_FLOOR', 0.45),
      cooldownSeconds: num(env, 'TRIGGER_COOLDOWN_SECONDS', 180),
      enabled: (env.TRIGGER_ENABLED ?? 'true') !== 'false',
      maxQuoteChars: num(env, 'MAX_QUOTE_CHARS', 400),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add package.json src/config.js test/config.test.js
git commit -m "feat: add configuration loading with required-key validation"
```

---

### Task 2: LM Studio client

**Files:**
- Create: `src/llm.js`
- Test: `test/llm.test.js`

**Interfaces:**
- Consumes: `Config.llm` from Task 1.
- Produces: `createLlm({ baseUrl, fetchImpl }) -> { chat, embed }` where
  `chat({ model, messages, temperature }) -> Promise<string>` returns the
  assistant message content, and `embed({ model, input }) -> Promise<number[][]>`
  returns one vector per input string. `input` is always an array.

- [ ] **Step 1: Write the failing test**

```javascript
// test/llm.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../src/llm.js';

function stubFetch(payload, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { fetchImpl, calls };
}

test('chat returns the assistant message content', async () => {
  const { fetchImpl, calls } = stubFetch({
    choices: [{ message: { role: 'assistant', content: 'hello' } }],
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const out = await llm.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(out, 'hello');
  assert.equal(calls[0].url, 'http://x/v1/chat/completions');
  assert.equal(calls[0].body.model, 'm');
});

test('embed returns one vector per input', async () => {
  const { fetchImpl } = stubFetch({
    data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
  });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });
  const vectors = await llm.embed({ model: 'e', input: ['a', 'b'] });

  assert.deepEqual(vectors, [[1, 2], [3, 4]]);
});

test('a non-2xx response throws with the status', async () => {
  const { fetchImpl } = stubFetch({ error: 'boom' }, { status: 500 });
  const llm = createLlm({ baseUrl: 'http://x/v1', fetchImpl });

  await assert.rejects(
    () => llm.chat({ model: 'm', messages: [] }),
    (err) => err.message.includes('500'),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/llm.js`.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// src/llm.js
export function createLlm({ baseUrl, fetchImpl = fetch }) {
  async function post(path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LM Studio request to ${path} failed with status ${res.status}`);
    }
    return res.json();
  }

  return {
    async chat({ model, messages, temperature = 0.8 }) {
      const json = await post('/chat/completions', { model, messages, temperature });
      return json.choices[0].message.content;
    },

    async embed({ model, input }) {
      const json = await post('/embeddings', { model, input });
      return json.data.map((d) => d.embedding);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 6 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js test/llm.test.js
git commit -m "feat: add LM Studio client for chat and embeddings"
```

---

### Task 3: Text chunking

**Files:**
- Create: `src/corpus/chunk.js`
- Test: `test/chunk.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `chunkText(text, { targetWords = 600, overlapWords = 90 }) ->
  Array<{ text: string, index: number }>`. Splits on blank-line paragraph
  boundaries, accumulating whole paragraphs until `targetWords` is reached.
  Consecutive chunks share roughly `overlapWords` of trailing text. A paragraph
  longer than `targetWords` becomes its own chunk rather than being split
  mid-sentence.

- [ ] **Step 1: Write the failing test**

```javascript
// test/chunk.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../src/corpus/chunk.js';

const para = (word, n) => Array.from({ length: n }, () => word).join(' ');

test('short text produces exactly one chunk', () => {
  const chunks = chunkText('a short paragraph here');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, 'a short paragraph here');
  assert.equal(chunks[0].index, 0);
});

test('long text splits into multiple chunks with sequential indices', () => {
  const text = [para('alpha', 400), para('beta', 400), para('gamma', 400)].join('\n\n');
  const chunks = chunkText(text, { targetWords: 500, overlapWords: 50 });

  assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
  chunks.forEach((c, i) => assert.equal(c.index, i));
});

test('consecutive chunks overlap', () => {
  const text = [para('alpha', 400), para('beta', 400)].join('\n\n');
  const chunks = chunkText(text, { targetWords: 500, overlapWords: 50 });

  const tailOfFirst = chunks[0].text.split(/\s+/).slice(-10).join(' ');
  assert.ok(
    chunks[1].text.startsWith(tailOfFirst),
    'second chunk should begin with the tail of the first',
  );
});

test('empty input produces no chunks', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('a single oversized paragraph is kept whole', () => {
  const chunks = chunkText(para('long', 2000), { targetWords: 500, overlapWords: 50 });
  assert.equal(chunks.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/corpus/chunk.js`.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// src/corpus/chunk.js
const words = (s) => s.split(/\s+/).filter(Boolean);

export function chunkText(text, { targetWords = 600, overlapWords = 90 } = {}) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks = [];
  let buffer = [];
  let count = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({ text: buffer.join('\n\n'), index: chunks.length });
    const tail = words(buffer[buffer.length - 1]).slice(-overlapWords);
    buffer = tail.length > 0 ? [tail.join(' ')] : [];
    count = tail.length;
  };

  for (const paragraph of paragraphs) {
    const n = words(paragraph).length;
    if (count > 0 && count + n > targetWords) flush();
    buffer.push(paragraph);
    count += n;
  }

  if (buffer.length > 0) {
    chunks.push({ text: buffer.join('\n\n'), index: chunks.length });
  }

  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 11 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/corpus/chunk.js test/chunk.test.js
git commit -m "feat: add paragraph-aware text chunking with overlap"
```

---

### Task 4: Corpus store

**Files:**
- Create: `src/corpus/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: chunk objects from Task 3.
- Produces:
  - `saveCorpus(dir, records) -> Promise<void>` where `records` is
    `Array<{ text, index, source: { title, author, chapter }, vector: number[] }>`.
    Writes `vectors.bin` (Float32, row-major) and `chunks.json`.
  - `loadCorpus(dir) -> Promise<{ chunks: Array<{text, index, source}>,
    vectors: Float32Array, dim: number, size: number }>`. A missing directory
    yields `{ chunks: [], vectors: new Float32Array(0), dim: 0, size: 0 }`.
  - `search(corpus, queryVector, k = 5) -> Array<{ chunk, score }>` sorted by
    descending cosine similarity. Returns `[]` for an empty corpus.

- [ ] **Step 1: Write the failing test**

```javascript
// test/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveCorpus, loadCorpus, search } from '../src/corpus/store.js';

const source = { title: 'T', author: 'A', chapter: '1' };

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'lubot-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('saved corpus round-trips through load', async () => {
  await withTempDir(async (dir) => {
    await saveCorpus(dir, [
      { text: 'first', index: 0, source, vector: [1, 0] },
      { text: 'second', index: 1, source, vector: [0, 1] },
    ]);
    const corpus = await loadCorpus(dir);

    assert.equal(corpus.size, 2);
    assert.equal(corpus.dim, 2);
    assert.equal(corpus.chunks[0].text, 'first');
    assert.deepEqual(corpus.chunks[1].source, source);
    assert.deepEqual([...corpus.vectors], [1, 0, 0, 1]);
  });
});

test('a missing corpus directory loads as empty, not an error', async () => {
  const corpus = await loadCorpus('/nonexistent/path/for/lubot');
  assert.deepEqual(corpus.chunks, []);
  assert.equal(corpus.size, 0);
  assert.equal(corpus.dim, 0);
});

test('search over an empty corpus returns no results', async () => {
  const corpus = await loadCorpus('/nonexistent/path/for/lubot');
  assert.deepEqual(search(corpus, [1, 0]), []);
});

test('search ranks by cosine similarity', async () => {
  await withTempDir(async (dir) => {
    await saveCorpus(dir, [
      { text: 'x-axis', index: 0, source, vector: [1, 0] },
      { text: 'y-axis', index: 1, source, vector: [0, 1] },
      { text: 'diagonal', index: 2, source, vector: [0.7, 0.7] },
    ]);
    const corpus = await loadCorpus(dir);
    const hits = search(corpus, [1, 0], 3);

    assert.equal(hits[0].chunk.text, 'x-axis');
    assert.equal(hits[1].chunk.text, 'diagonal');
    assert.ok(hits[0].score > hits[1].score);
    assert.ok(hits[0].score > 0.99, `expected ~1.0, got ${hits[0].score}`);
  });
});

test('search respects k', async () => {
  await withTempDir(async (dir) => {
    await saveCorpus(dir, [
      { text: 'a', index: 0, source, vector: [1, 0] },
      { text: 'b', index: 1, source, vector: [0, 1] },
    ]);
    const corpus = await loadCorpus(dir);
    assert.equal(search(corpus, [1, 0], 1).length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/corpus/store.js`.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// src/corpus/store.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const VECTORS = 'vectors.bin';
const CHUNKS = 'chunks.json';

const EMPTY = { chunks: [], vectors: new Float32Array(0), dim: 0, size: 0 };

export async function saveCorpus(dir, records) {
  await mkdir(dir, { recursive: true });
  const dim = records.length > 0 ? records[0].vector.length : 0;

  const flat = new Float32Array(records.length * dim);
  records.forEach((r, i) => {
    if (r.vector.length !== dim) {
      throw new Error(`Vector ${i} has length ${r.vector.length}, expected ${dim}`);
    }
    flat.set(r.vector, i * dim);
  });

  const chunks = records.map(({ text, index, source }) => ({ text, index, source }));
  await writeFile(join(dir, VECTORS), Buffer.from(flat.buffer));
  await writeFile(join(dir, CHUNKS), JSON.stringify({ dim, chunks }, null, 2));
}

export async function loadCorpus(dir) {
  let meta;
  try {
    meta = JSON.parse(await readFile(join(dir, CHUNKS), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY;
    throw err;
  }

  const buf = await readFile(join(dir, VECTORS));
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

  return { chunks: meta.chunks, vectors, dim: meta.dim, size: meta.chunks.length };
}

export function search(corpus, queryVector, k = 5) {
  if (corpus.size === 0 || corpus.dim === 0) return [];

  let qNorm = 0;
  for (const v of queryVector) qNorm += v * v;
  qNorm = Math.sqrt(qNorm);
  if (qNorm === 0) return [];

  const scored = [];
  for (let i = 0; i < corpus.size; i += 1) {
    const offset = i * corpus.dim;
    let dot = 0;
    let norm = 0;
    for (let d = 0; d < corpus.dim; d += 1) {
      const value = corpus.vectors[offset + d];
      dot += value * queryVector[d];
      norm += value * value;
    }
    norm = Math.sqrt(norm);
    scored.push({ chunk: corpus.chunks[i], score: norm === 0 ? 0 : dot / (norm * qNorm) });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 16 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/corpus/store.js test/store.test.js
git commit -m "feat: add corpus store with binary vectors and cosine search"
```

---

### Task 5: Quote verifier

This is the defence against fabricated quotations described in the spec. Its
test deliberately feeds it an invented quote.

**Files:**
- Create: `src/quotes.js`
- Test: `test/quotes.test.js`

**Interfaces:**
- Consumes: chunk objects from Task 4.
- Produces: `verifyQuotes(reply, chunks, { maxQuoteChars = Infinity }) ->
  { ok: boolean, fabricated: string[], overlong: string[] }`.
  Extracts spans wrapped in straight or curly double quotes, and reports any
  whose normalised text does not appear in any supplied chunk. Normalisation
  collapses whitespace and unifies quote and dash characters. Spans of fewer
  than five words are ignored — short quoted phrases are ordinary English
  emphasis, not citations.

- [ ] **Step 1: Write the failing test**

```javascript
// test/quotes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyQuotes } from '../src/quotes.js';

const chunks = [
  { text: 'Political power grows out of the barrel of a gun. That is the lesson.' },
  { text: 'The philosophers have only interpreted the world, in various ways.' },
];

test('a genuine quote passes', () => {
  const reply = 'As he put it, "Political power grows out of the barrel of a gun."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
});

test('a quote longer than maxQuoteChars is rejected', () => {
  const long = [{ text: `x ${'word '.repeat(100)}y` }];
  const reply = `He wrote, "${'word '.repeat(100).trim()}"`;
  const result = verifyQuotes(reply, long, { maxQuoteChars: 50 });
  assert.equal(result.ok, false);
  assert.equal(result.overlong.length, 1);
});

test('a fabricated quote is caught', () => {
  const reply = 'He famously wrote, "The revolution begins in the heart of the worker."';
  const result = verifyQuotes(reply, chunks);

  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
});

test('whitespace and curly quotes do not cause false failures', () => {
  const reply = 'He said, “Political  power   grows out of\nthe barrel of a gun”.';
  assert.equal(verifyQuotes(reply, chunks).ok, true);
});

test('short quoted phrases are ignored as emphasis', () => {
  const reply = 'The so-called "barrel of a gun" idea is often misread.';
  assert.equal(verifyQuotes(reply, chunks).ok, true);
});

test('a reply with no quotes passes trivially', () => {
  const result = verifyQuotes('Just talking, no citation here.', chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
});

test('any quote fails when no chunks were supplied', () => {
  const reply = 'He wrote, "Political power grows out of the barrel of a gun."';
  assert.equal(verifyQuotes(reply, []).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/quotes.js`.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// src/quotes.js
const MIN_QUOTE_WORDS = 5;

function normalise(s) {
  return s
    .replace(/[“”″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractQuotes(reply) {
  const matches = reply.match(/["“]([^"“”]+)["”]/g) ?? [];
  return matches
    .map((m) => m.slice(1, -1).trim())
    .filter((q) => q.split(/\s+/).filter(Boolean).length >= MIN_QUOTE_WORDS);
}

export function verifyQuotes(reply, chunks, { maxQuoteChars = Infinity } = {}) {
  const quotes = extractQuotes(reply);
  if (quotes.length === 0) return { ok: true, fabricated: [], overlong: [] };

  const haystack = chunks.map((c) => normalise(c.text)).join('\n');
  const fabricated = quotes.filter((q) => {
    const needle = normalise(q).replace(/[.,;:!?]+$/, '');
    return !haystack.includes(needle);
  });
  const overlong = quotes.filter((q) => q.length > maxQuoteChars);

  return { ok: fabricated.length === 0 && overlong.length === 0, fabricated, overlong };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 22 tests total.

- [ ] **Step 5: Prove the verifier actually verifies**

The test suite is only meaningful if the fabrication test genuinely depends on
the check. Break the implementation on purpose and confirm the right test goes
red.

```bash
# Temporarily make verifyQuotes always pass
node -e "const f='src/quotes.js';const s=require('fs').readFileSync(f,'utf8');require('fs').writeFileSync(f,s.replace('const fabricated = quotes.filter','const fabricated = [].filter'))"
grep -n 'const fabricated = \[\].filter' src/quotes.js   # MUST print a line — proves the edit landed
npm test 2>&1 | tail -20                                  # MUST fail on "a fabricated quote is caught"
git checkout src/quotes.js
npm test 2>&1 | tail -5                                   # back to green
```

Expected: the `grep` prints the mutated line, `npm test` then fails on the
fabrication test specifically, and passes again after restore. If the grep
prints nothing the mutation did not land and this step proved nothing — fix
the mutation and repeat.

- [ ] **Step 6: Commit**

```bash
git add src/quotes.js test/quotes.test.js
git commit -m "feat: add quote verifier rejecting fabricated citations"
```

---

### Task 6: Ingest script

**Files:**
- Create: `src/corpus/ingest.js`
- Create: `scripts/ingest.js`
- Create: `data/raw/.gitkeep`
- Test: `test/ingest.test.js`

**Interfaces:**
- Consumes: `chunkText` (Task 3), `saveCorpus` (Task 4), `createLlm` (Task 2).
- Produces: `ingestFiles({ files, llm, embedModel, batchSize = 32 }) ->
  Promise<Array<{ text, index, source, vector }>>`, where `files` is
  `Array<{ path: string, title: string, author: string }>`. Reads each file,
  chunks it, embeds all chunks in batches, and returns records ready for
  `saveCorpus`. `scripts/ingest.js` is the CLI wrapper reading `data/raw/`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/ingest.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestFiles } from '../src/corpus/ingest.js';

const fakeLlm = {
  async embed({ input }) {
    return input.map((text) => [text.length, 1, 0]);
  },
};

test('ingests a file into embedded records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lubot-ingest-'));
  try {
    const path = join(dir, 'book.txt');
    await writeFile(path, 'First paragraph here.\n\nSecond paragraph here.');

    const records = await ingestFiles({
      files: [{ path, title: 'Book', author: 'Someone' }],
      llm: fakeLlm,
      embedModel: 'embed',
    });

    assert.ok(records.length >= 1);
    assert.equal(records[0].source.title, 'Book');
    assert.equal(records[0].source.author, 'Someone');
    assert.equal(records[0].vector.length, 3);
    records.forEach((r, i) => assert.equal(r.index, i));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ingesting no files yields no records', async () => {
  const records = await ingestFiles({ files: [], llm: fakeLlm, embedModel: 'embed' });
  assert.deepEqual(records, []);
});

test('embeds in batches without dropping chunks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lubot-batch-'));
  try {
    const path = join(dir, 'long.txt');
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i}.`);
    await writeFile(path, paragraphs.join('\n\n'));

    const records = await ingestFiles({
      files: [{ path, title: 'Long', author: 'A' }],
      llm: fakeLlm,
      embedModel: 'embed',
      batchSize: 3,
    });

    assert.ok(records.every((r) => Array.isArray(r.vector) && r.vector.length === 3));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/corpus/ingest.js`.

- [ ] **Step 3: Write the minimal implementation**

```javascript
// src/corpus/ingest.js
import { readFile } from 'node:fs/promises';
import { chunkText } from './chunk.js';

export async function ingestFiles({ files, llm, embedModel, batchSize = 32 }) {
  const pending = [];

  for (const file of files) {
    const text = await readFile(file.path, 'utf8');
    for (const chunk of chunkText(text)) {
      pending.push({
        text: chunk.text,
        source: { title: file.title, author: file.author, chapter: null },
      });
    }
  }

  const records = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const vectors = await llm.embed({ model: embedModel, input: batch.map((b) => b.text) });
    batch.forEach((item, j) => {
      records.push({ ...item, index: records.length, vector: vectors[j] });
    });
  }

  return records;
}
```

```javascript
// scripts/ingest.js
import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLlm } from '../src/llm.js';
import { ingestFiles } from '../src/corpus/ingest.js';
import { saveCorpus } from '../src/corpus/store.js';

const RAW_DIR = 'data/raw';
const OUT_DIR = 'data/corpus';

const config = loadConfig(process.env);
const llm = createLlm({ baseUrl: config.llm.baseUrl });

let entries = [];
try {
  entries = await readdir(RAW_DIR);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const files = entries
  .filter((name) => extname(name) === '.txt')
  .map((name) => ({
    path: join(RAW_DIR, name),
    title: basename(name, '.txt'),
    author: 'unknown',
  }));

if (files.length === 0) {
  console.log(`No .txt files in ${RAW_DIR}. Corpus left empty; Lu Bot will run persona-only.`);
  process.exit(0);
}

console.log(`Ingesting ${files.length} file(s)...`);
const records = await ingestFiles({ files, llm, embedModel: config.llm.embedModel });
await saveCorpus(OUT_DIR, records);
console.log(`Wrote ${records.length} chunks to ${OUT_DIR}.`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 25 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/corpus/ingest.js scripts/ingest.js data/raw/.gitkeep test/ingest.test.js
git commit -m "feat: add corpus ingestion with batched embedding"
```

---

### Task 7: Persona and responder

**Files:**
- Create: `persona/lu-bot.md`
- Create: `src/persona.js`
- Create: `src/responder.js`
- Test: `test/responder.test.js`

**Interfaces:**
- Consumes: `createLlm` (Task 2), `verifyQuotes` (Task 5), `Config` (Task 1).
- Produces:
  - `loadPersona(path) -> Promise<string>` — the persona file's contents.
  - `buildMessages({ persona, chunks, history, message }) -> Array<{role, content}>`
    — a system message combining persona and any retrieved chunks, then history,
    then the user message.
  - `respond({ message, chunks, history, persona, llm, config }) -> Promise<string|null>`
    — generates, verifies quotes, and returns the reply, or `null` if the reply
    could not be made safe.

- [ ] **Step 1: Write the failing test**

```javascript
// test/responder.test.js
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

test('a conversational reply with no quotes passes even with no chunks', async () => {
  const out = await respond({
    message: 'hello', chunks: [], history: [], persona,
    llm: llmReturning('Good morning, comrade.'), config,
  });
  assert.equal(out, 'Good morning, comrade.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/responder.js`.

- [ ] **Step 3: Write the persona file and implementation**

```markdown
<!-- persona/lu-bot.md -->
You are Lu Bot, named after the Chinese weightlifter Lu Xiaojun.

You are a Chinese Maoist. You are cheeky but serious: quick with a dry remark,
never flippant about things that matter. You have a sense of humour and you use
it, but you do not clown.

You speak in ordinary conversational English. You are talking in a Discord
channel with several people, so keep replies short — a few sentences, rarely
more than a short paragraph.

You have access to a corpus of political texts. When a passage genuinely bears
on what is being discussed, you may quote it and say which work it came from.

Rules you follow absolutely:
- Only quote text that has been supplied to you in this conversation. Never
  reconstruct a quotation from memory, and never invent one.
- If you have no supplied passage, talk normally without quoting. Saying
  nothing is better than inventing a citation.
- Do not append citations to points that did not come from a supplied passage.
```

```javascript
// src/persona.js
import { readFile } from 'node:fs/promises';

export function loadPersona(path) {
  return readFile(path, 'utf8');
}
```

```javascript
// src/responder.js
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
    ];
    console.warn(`Dropped reply — ${reasons.join(' | ')}`);
    return null;
  }

  return reply;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 32 tests total.

- [ ] **Step 5: Commit**

```bash
git add persona/lu-bot.md src/persona.js src/responder.js test/responder.test.js
git commit -m "feat: add persona loading and quote-verified responder"
```

---

### Task 8: Discord adapter and entrypoint

Installing `discord.js` happens here — the only runtime dependency in the plan.

**Files:**
- Create: `src/discord.js`
- Create: `src/index.js`
- Modify: `package.json` (add the `discord.js` dependency)
- Test: `test/discord.test.js`

**Interfaces:**
- Consumes: `Config` (Task 1), `respond` (Task 7), `loadCorpus`/`search` (Task 4),
  `createLlm` (Task 2).
- Produces:
  - `shouldHandle(msg, { botId, allowedChannels }) -> boolean` — a pure
    predicate. `msg` is `{ authorId, authorIsBot, channelId, mentionsBot }`.
  - `startBot({ config, onMention }) -> Promise<Client>` — wires discord.js and
    calls `onMention({ content, channelId, authorId }) -> Promise<string|null>`.

- [ ] **Step 1: Write the failing test**

The predicate is pure, so it is tested without discord.js running.

```javascript
// test/discord.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandle } from '../src/discord.js';

const opts = { botId: 'bot', allowedChannels: ['chan'] };
const base = { authorId: 'human', authorIsBot: false, channelId: 'chan', mentionsBot: true };

test('handles a mention from a human in an allowed channel', () => {
  assert.equal(shouldHandle(base, opts), true);
});

test('ignores its own messages', () => {
  assert.equal(shouldHandle({ ...base, authorId: 'bot' }, opts), false);
});

test('ignores other bots', () => {
  assert.equal(shouldHandle({ ...base, authorIsBot: true }, opts), false);
});

test('ignores channels not on the allowlist', () => {
  assert.equal(shouldHandle({ ...base, channelId: 'other' }, opts), false);
});

test('ignores messages that do not mention it', () => {
  assert.equal(shouldHandle({ ...base, mentionsBot: false }, opts), false);
});

test('an empty allowlist permits no channels', () => {
  assert.equal(shouldHandle(base, { ...opts, allowedChannels: [] }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/discord.js`.

- [ ] **Step 3: Install discord.js and write the implementation**

```bash
npm install discord.js
```

```javascript
// src/discord.js
import { Client, GatewayIntentBits, Events } from 'discord.js';

export function shouldHandle(msg, { botId, allowedChannels }) {
  if (msg.authorIsBot) return false;
  if (msg.authorId === botId) return false;
  if (!allowedChannels.includes(msg.channelId)) return false;
  return msg.mentionsBot === true;
}

export async function startBot({ config, onMention }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.MessageCreate, async (message) => {
    const view = {
      authorId: message.author.id,
      authorIsBot: message.author.bot,
      channelId: message.channelId,
      mentionsBot: message.mentions.users.has(client.user.id),
    };
    if (!shouldHandle(view, { botId: client.user.id, allowedChannels: config.discord.allowedChannels })) {
      return;
    }

    const content = message.content.replace(/<@!?\d+>/g, '').trim();
    try {
      const reply = await onMention({ content, channelId: message.channelId, authorId: message.author.id });
      if (reply) await message.reply(reply);
    } catch (err) {
      console.error('Failed to handle mention:', err);
    }
  });

  await client.login(config.discord.token);
  return client;
}
```

```javascript
// src/index.js
import { loadConfig } from './config.js';
import { createLlm } from './llm.js';
import { loadPersona } from './persona.js';
import { respond } from './responder.js';
import { loadCorpus, search } from './corpus/store.js';
import { startBot } from './discord.js';

const HISTORY_LIMIT = 12;

const config = loadConfig(process.env);
const llm = createLlm({ baseUrl: config.llm.baseUrl });
const persona = await loadPersona('persona/lu-bot.md');
const corpus = await loadCorpus('data/corpus');

console.log(
  corpus.size > 0
    ? `Loaded ${corpus.size} chunks (${corpus.dim} dimensions).`
    : 'No corpus found. Running persona-only.',
);

const histories = new Map();

async function retrieve(content) {
  if (corpus.size === 0) return [];
  const [vector] = await llm.embed({ model: config.llm.embedModel, input: [content] });
  return search(corpus, vector, 5)
    .filter((hit) => hit.score >= config.trigger.similarityFloor)
    .map((hit) => hit.chunk);
}

await startBot({
  config,
  async onMention({ content, channelId }) {
    const history = histories.get(channelId) ?? [];
    const chunks = await retrieve(content);
    const reply = await respond({ message: content, chunks, history, persona, llm, config });

    if (reply) {
      histories.set(
        channelId,
        [...history, { role: 'user', content }, { role: 'assistant', content: reply }]
          .slice(-HISTORY_LIMIT),
      );
    }
    return reply;
  },
});

console.log('Lu Bot is online.');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 38 tests total.

- [ ] **Step 5: Verify against the real stack**

This is the first point where the whole thing can be run for real. It needs LM
Studio serving and a token in `.env`.

```bash
LMS="/Applications/LM Studio.app/Contents/Resources/app/.webpack/lms"
"$LMS" ls                    # read the exact model keys — do not guess them
"$LMS" server start
"$LMS" load <chat-model-key-from-ls>
curl -s http://localhost:1234/v1/models | head   # MUST list the loaded model
npm start                                         # MUST print "Lu Bot is online."
```

Put the exact key from `lms ls` into `.env` as `LLM_CHAT_MODEL`. The identifier
LM Studio serves under is whatever `lms ls` prints, not the HuggingFace repo
name.

Then mention the bot in an allowlisted channel and confirm it replies in
persona. Record what it actually said — this is evidence the stack works, not
a claim that it does.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/discord.js src/index.js test/discord.test.js
git commit -m "feat: add Discord adapter and entrypoint responding to mentions"
```

---

## What this plan does not cover

Deferred to a second plan, once the foundation above is proven working:

- The two-stage proactive trigger (embedding gate plus judge model).
- The replay harness for tuning trigger thresholds against saved history.
- Cooldown and kill-switch enforcement for unprompted messages.
- **Chapter-level metadata.** Task 6 records `chapter: null`, because a plain
  `.txt` file carries no chapter markers to parse. The field exists in the
  stored shape so populating it later does not require re-designing the store,
  but citations will name the work and author only until a text with parseable
  structure is ingested.

`TRIGGER_*` configuration keys are parsed by Task 1 and the similarity floor is
already used for retrieval, so the second plan adds behaviour rather than
reworking configuration.
