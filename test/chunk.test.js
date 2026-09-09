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

test('consecutive chunks overlap with trailing (not leading) text from the previous chunk', () => {
  const tokens = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
  const p1Tokens = tokens('p1', 400);
  const p2Tokens = tokens('p2', 400);
  const text = [p1Tokens.join(' '), p2Tokens.join(' ')].join('\n\n');
  const overlapWords = 50;
  const chunks = chunkText(text, { targetWords: 500, overlapWords });

  assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);

  const trailingOfP1 = p1Tokens.slice(-overlapWords).join(' ');
  const leadingOfP1 = p1Tokens.slice(0, overlapWords).join(' ');
  const startOfSecond = chunks[1].text.split(/\s+/).slice(0, overlapWords).join(' ');

  assert.equal(
    startOfSecond,
    trailingOfP1,
    'the second chunk should begin with the trailing words carried over from the first paragraph',
  );
  assert.notEqual(
    startOfSecond,
    leadingOfP1,
    'the second chunk must not begin with the leading words of the first paragraph',
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

test('overlapWords: 0 produces no carried-over text between chunks', () => {
  const text = [para('alpha', 400), para('beta', 400)].join('\n\n');
  const chunks = chunkText(text, { targetWords: 500, overlapWords: 0 });

  assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
  assert.ok(
    !chunks[1].text.includes('alpha'),
    'with overlapWords: 0, the second chunk should not contain any words carried over from the first paragraph',
  );
});
