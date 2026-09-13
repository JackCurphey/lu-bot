import { readFile } from 'node:fs/promises';
import { chunkText } from './chunk.js';

// The embedding half of the pipeline, split out of ingestFiles so the runtime
// path (src/corpus/library.js) can reach it with text that never came from a
// file on disk. ingestFiles is now a thin reader in front of it.
export async function ingestTexts({ docs, llm, embedModel, batchSize = 32, chunkOptions }) {
  const pending = [];

  for (const doc of docs) {
    for (const chunk of chunkText(doc.text, chunkOptions)) {
      const source = { title: doc.title, author: doc.author, chapter: null };
      // Absent, not null, on a curated document: the presence of the key is
      // what tells the two apart everywhere downstream, so a null would make
      // every curated chunk look learned.
      if (doc.learned) source.learned = doc.learned;
      pending.push({ text: chunk.text, source });
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

export async function ingestFiles({ files, llm, embedModel, batchSize = 32 }) {
  const docs = await Promise.all(files.map(async (file) => ({
    text: await readFile(file.path, 'utf8'),
    title: file.title,
    author: file.author,
  })));
  return ingestTexts({ docs, llm, embedModel, batchSize });
}
