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
  // Copy out of the Buffer's pooled ArrayBuffer: Node pools small buffers, and a
  // byteOffset that is not a multiple of 4 makes the Float32Array view throw.
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  const vectors = new Float32Array(bytes.buffer);

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
