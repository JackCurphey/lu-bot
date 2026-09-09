import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { loadLlmConfig } from '../src/config.js';
import { createLlm } from '../src/llm.js';
import { ingestFiles } from '../src/corpus/ingest.js';
import { saveCorpus } from '../src/corpus/store.js';

const RAW_DIR = 'data/raw';
const OUT_DIR = 'data/corpus';

const llmConfig = loadLlmConfig(process.env);
const llm = createLlm({ baseUrl: llmConfig.baseUrl });

let entries = [];
try {
  entries = await readdir(RAW_DIR);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const files = entries
  .filter((name) => extname(name) === '.txt')
  .map((name) => ({
    path: join(RAW_DIR, name),
    title: basename(name, '.txt'),
    author: 'unknown',
  }));

if (files.length === 0) {
  console.log(`No .txt files in ${RAW_DIR}. Corpus left empty; Lu Bot will run persona-only.`);
  process.exit(0);
}

console.log(`Ingesting ${files.length} file(s)...`);
const records = await ingestFiles({ files, llm, embedModel: llmConfig.embedModel });
await saveCorpus(OUT_DIR, records);
console.log(`Wrote ${records.length} chunks to ${OUT_DIR}.`);
