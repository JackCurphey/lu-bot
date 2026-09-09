import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestFiles } from '../src/corpus/ingest.js';
import { chunkText } from '../src/corpus/chunk.js';

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
  // The previous version of this test built 20 short paragraphs, which
  // chunkText collapses into a single chunk. batchSize: 3 therefore never
  // triggered a second iteration and the "no chunks dropped" assertion was
  // vacuously true over a one-element array — the test could not fail. These
  // paragraphs are long enough to force several chunks, and the assertions
  // now pin the batching arithmetic itself.
  const dir = await mkdtemp(join(tmpdir(), 'lubot-batch-'));
  try {
    const path = join(dir, 'long.txt');
    const paragraphs = Array.from(
      { length: 8 },
      (_, i) => `Paragraph ${i} begins. ${`token${i} `.repeat(199).trim()}`,
    );
    const text = paragraphs.join('\n\n');
    await writeFile(path, text);

    const expected = chunkText(text);
    assert.ok(expected.length >= 4, `fixture must force several chunks, got ${expected.length}`);

    const batchSize = 3;
    const batchSizes = [];
    const countingLlm = {
      async embed({ input }) {
        batchSizes.push(input.length);
        return input.map((t) => [t.length, 1, 0]);
      },
    };

    const records = await ingestFiles({
      files: [{ path, title: 'Long', author: 'A' }],
      llm: countingLlm,
      embedModel: 'embed',
      batchSize,
    });

    // (a) one embed call per batch, and no batch larger than batchSize.
    assert.equal(batchSizes.length, Math.ceil(expected.length / batchSize));
    assert.ok(batchSizes.every((n) => n > 0 && n <= batchSize), `batch sizes: ${batchSizes}`);
    assert.equal(batchSizes.reduce((a, b) => a + b, 0), expected.length);

    // (b) every chunk appears exactly once, in order.
    assert.equal(records.length, expected.length);
    assert.deepEqual(records.map((r) => r.text), expected.map((c) => c.text));

    // (c) record indices are sequential with no gaps or repeats.
    assert.deepEqual(
      records.map((r) => r.index),
      Array.from({ length: expected.length }, (_, i) => i),
    );
    assert.ok(records.every((r) => Array.isArray(r.vector) && r.vector.length === 3));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
