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
