import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractPdfText } from '../src/corpus/pdf.js';
import { LearnError } from '../src/corpus/errors.js';

const fixture = async (name) => new Uint8Array(
  await readFile(join(import.meta.dirname, 'fixtures', name)),
);

test('the text of a PDF comes back, with its page count', async () => {
  const got = await extractPdfText(await fixture('probe.pdf'), { minChars: 10 });
  assert.match(got.text, /material conditions of the fixture/);
  assert.equal(got.pages, 1);
});

test('a PDF with no text layer is refused rather than ingested empty', async () => {
  await assert.rejects(
    async () => extractPdfText(await fixture('no-text.pdf'), { minChars: 10 }),
    (err) => err instanceof LearnError && err.code === 'noText',
  );
});

test('a PDF whose text is shorter than the floor is refused', async () => {
  await assert.rejects(
    async () => extractPdfText(await fixture('probe.pdf'), { minChars: 5000 }),
    (err) => err instanceof LearnError && err.code === 'noText',
  );
});

test('bytes that are not a PDF at all are refused, not thrown raw', async () => {
  await assert.rejects(
    () => extractPdfText(new Uint8Array([1, 2, 3]), { minChars: 10 }),
    (err) => err instanceof LearnError && err.code === 'unreadable',
  );
});

test('a title and author are null when the file carries none', async () => {
  const got = await extractPdfText(await fixture('probe.pdf'), { minChars: 10 });
  assert.equal(got.title, null);
  assert.equal(got.author, null);
});
