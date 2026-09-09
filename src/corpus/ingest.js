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
