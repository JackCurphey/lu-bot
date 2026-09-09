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
