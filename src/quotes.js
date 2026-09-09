const MIN_QUOTE_WORDS = 5;

function normalise(s) {
  return s
    .replace(/[“”″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractQuotes(reply) {
  const matches = reply.match(/["“]([^"“”]+)["”]/g) ?? [];
  return matches
    .map((m) => m.slice(1, -1).trim())
    .filter((q) => q.split(/\s+/).filter(Boolean).length >= MIN_QUOTE_WORDS);
}

export function verifyQuotes(reply, chunks, { maxQuoteChars = Infinity } = {}) {
  const quotes = extractQuotes(reply);
  if (quotes.length === 0) return { ok: true, fabricated: [], overlong: [] };

  const haystack = chunks.map((c) => normalise(c.text)).join('\n');
  const fabricated = quotes.filter((q) => {
    const needle = normalise(q).replace(/[.,;:!?]+$/, '');
    return !haystack.includes(needle);
  });
  const overlong = quotes.filter((q) => q.length > maxQuoteChars);

  return { ok: fabricated.length === 0 && overlong.length === 0, fabricated, overlong };
}
