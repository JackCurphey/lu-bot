const words = (s) => s.split(/\s+/).filter(Boolean);

export function chunkText(text, { targetWords = 600, overlapWords = 90 } = {}) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks = [];
  let buffer = [];
  let count = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({ text: buffer.join('\n\n'), index: chunks.length });
    const tail = overlapWords > 0 ? words(buffer[buffer.length - 1]).slice(-overlapWords) : [];
    buffer = tail.length > 0 ? [tail.join(' ')] : [];
    count = tail.length;
  };

  for (const paragraph of paragraphs) {
    const n = words(paragraph).length;
    if (count > 0 && count + n > targetWords) flush();
    buffer.push(paragraph);
    count += n;
  }

  if (buffer.length > 0) {
    chunks.push({ text: buffer.join('\n\n'), index: chunks.length });
  }

  return chunks;
}
