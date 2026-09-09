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

  const startOfSecond = chunks[1].text.split(/\s+/).slice(0, 10).join(' ');
  assert.ok(
    chunks[0].text.includes(startOfSecond),
    'the second chunk should begin with text carried over from the first',
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
