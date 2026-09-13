import { getDocumentProxy, extractText, getMeta } from 'unpdf';
import { LearnError } from './errors.js';

const clean = (value) => {
  const s = typeof value === 'string' ? value.trim() : '';
  return s === '' ? null : s;
};

// Pages are joined with a blank line because chunkText splits on blank lines
// (src/corpus/chunk.js:6). Joining with a single newline would fuse the last
// paragraph of one page to the first of the next into one unsplittable block.
export async function extractPdfText(bytes, { minChars }) {
  let pdf;
  let extracted;
  let meta;
  try {
    // Parsed once and reused: getDocumentProxy accepts the bytes, and both
    // extractText and getMeta accept the proxy.
    pdf = await getDocumentProxy(bytes);
    extracted = await extractText(pdf, { mergePages: false });
    meta = await getMeta(pdf);
  } catch (err) {
    // Malformed, encrypted, or not a PDF once past the magic bytes. A raw
    // pdf.js error must not escape this module: everything above maps codes.
    throw new LearnError('unreadable', err?.message ?? 'could not parse the pdf');
  }

  const text = extracted.text.join('\n\n').trim();
  // The scanned-PDF case (L7). There is no OCR here, and an empty document in
  // the corpus is worse than a refusal, because nothing downstream would ever
  // report it.
  if (text.length < minChars) {
    throw new LearnError('noText', `only ${text.length} characters of text`);
  }

  return {
    text,
    title: clean(meta.info?.Title),
    author: clean(meta.info?.Author),
    pages: extracted.totalPages,
  };
}
