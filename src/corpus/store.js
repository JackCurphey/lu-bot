import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
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
  // Written to temp files and renamed, because this is now called at runtime
  // (src/corpus/library.js) and not only by scripts/ingest.js. A crash partway
  // through a direct write leaves a truncated vectors.bin that loadCorpus will
  // read as a corpus of garbage vectors, with nothing to signal it.
  //
  // The two renames are not atomic *with each other*. Vectors go first: a
  // crash in the gap leaves the previous chunks.json with the new vectors,
  // and since loadCorpus sizes the corpus by chunks.length, an append
  // degrades to "the new chunks are not visible yet" rather than to
  // misalignment. A removal crashing in that gap can misalign text and
  // vectors until the next successful write; the window is two renames wide
  // and the repair is to re-run the removal.
  await writeFile(join(dir, `${VECTORS}.tmp`), Buffer.from(flat.buffer));
  await writeFile(join(dir, `${CHUNKS}.tmp`), JSON.stringify({ dim, chunks }, null, 2));
  await rename(join(dir, `${VECTORS}.tmp`), join(dir, VECTORS));
  await rename(join(dir, `${CHUNKS}.tmp`), join(dir, CHUNKS));
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

// The in-memory corpus is a flat Float32Array plus a parallel chunk list, so
// merging is two concatenations. Kept here rather than in library.js so
// everything that knows the storage layout stays in one file.
export function mergeCorpora(a, b) {
  if (a.size === 0) return b;
  if (b.size === 0) return a;
  if (a.dim !== b.dim) {
    throw new Error(
      `Corpus dimension mismatch: ${a.dim} and ${b.dim}. ` +
      'One of these was embedded with a different model than the other.',
    );
  }
  const vectors = new Float32Array(a.vectors.length + b.vectors.length);
  vectors.set(a.vectors, 0);
  vectors.set(b.vectors, a.vectors.length);
  return {
    chunks: [...a.chunks, ...b.chunks],
    vectors,
    dim: a.dim,
    size: a.size + b.size,
  };
}

// The inverse of what saveCorpus consumes, so a loaded corpus can be edited
// and written back without a second trip through the embedding model.
export function toRecords(corpus) {
  return corpus.chunks.map((chunk, i) => ({
    ...chunk,
    vector: corpus.vectors.slice(i * corpus.dim, (i + 1) * corpus.dim),
  }));
}

// Title match is case-insensitive and exact. A substring match would let
// "lu forget capital" take out "Capital, Volume I" and "The Capital Levy"
// together, and the caller cannot tell afterwards what it lost.
export function removeChunksBySource(records, title) {
  const wanted = String(title).trim().toLowerCase();
  const left = records.filter((r) => (r.source?.title ?? '').toLowerCase() !== wanted);
  return {
    records: left.map((r, i) => ({ ...r, index: i })),
    removed: records.length - left.length,
  };
}
