// test/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveCorpus, loadCorpus, search, mergeCorpora, toRecords, removeChunksBySource } from '../src/corpus/store.js';

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

const rec = (text, title, vector) => ({ text, index: 0, source: { title, author: 'a', chapter: null }, vector });

test('two corpora merge into one searchable corpus', async () => {
  await withTempDir(async (dir) => {
    await saveCorpus(join(dir, 'a'), [rec('one', 'A', new Float32Array([1, 0]))]);
    await saveCorpus(join(dir, 'b'), [rec('two', 'B', new Float32Array([0, 1]))]);

    const merged = mergeCorpora(await loadCorpus(join(dir, 'a')), await loadCorpus(join(dir, 'b')));
    assert.equal(merged.size, 2);
    assert.equal(merged.dim, 2);
    assert.equal(search(merged, new Float32Array([0, 1]), 1)[0].chunk.text, 'two');
  });
});

test('merging an empty corpus changes nothing', async () => {
  await withTempDir(async (dir) => {
    await saveCorpus(join(dir, 'a'), [rec('one', 'A', new Float32Array([1, 0]))]);
    const a = await loadCorpus(join(dir, 'a'));
    const empty = await loadCorpus(join(dir, 'missing'));
    assert.equal(mergeCorpora(a, empty).size, 1);
    assert.equal(mergeCorpora(empty, a).size, 1);
  });
});

test('merging corpora embedded at different dimensions throws rather than corrupting', async () => {
  await withTempDir(async (dir) => {
    await saveCorpus(join(dir, 'a'), [rec('one', 'A', new Float32Array([1, 0]))]);
    await saveCorpus(join(dir, 'b'), [rec('two', 'B', new Float32Array([0, 1, 0]))]);
    const a = await loadCorpus(join(dir, 'a'));
    const b = await loadCorpus(join(dir, 'b'));
    assert.throws(() => mergeCorpora(a, b), /dimension/i);
  });
});

test('a corpus round-trips through toRecords back into saveCorpus', async () => {
  await withTempDir(async (dir) => {
    const original = [rec('one', 'A', new Float32Array([1, 0])), rec('two', 'B', new Float32Array([0, 1]))];
    await saveCorpus(join(dir, 'a'), original);
    const records = toRecords(await loadCorpus(join(dir, 'a')));
    assert.equal(records.length, 2);
    assert.deepEqual([...records[1].vector], [0, 1]);

    await saveCorpus(join(dir, 'b'), records);
    assert.equal((await loadCorpus(join(dir, 'b'))).size, 2);
  });
});

test('removing a source drops its chunks and reindexes the rest', () => {
  const records = [
    rec('one', 'Keep', new Float32Array([1, 0])),
    rec('two', 'Drop', new Float32Array([0, 1])),
    rec('three', 'Keep', new Float32Array([1, 1])),
  ];
  const { records: left, removed } = removeChunksBySource(records, 'drop');
  assert.equal(removed, 1);
  assert.deepEqual(left.map((r) => r.text), ['one', 'three']);
  assert.deepEqual(left.map((r) => r.index), [0, 1]);
});

test('a save leaves no temp files behind', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'a');
    await saveCorpus(target, [rec('one', 'A', new Float32Array([1, 0]))]);
    const left = await readdir(target);
    assert.deepEqual(left.sort(), ['chunks.json', 'vectors.bin']);
  });
});
