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

// Extracts quoted spans, treating curly "" and straight "" pairs as
// distinct delimiter styles so a curly pair can't be closed by a straight
// quote (or vice versa). Straight double quotes are matched only in
// balanced pairs; an odd count of straight quotes means the reply's
// quoting is ambiguous and must be reported as unverifiable rather than
// silently mis-paired.
function extractQuotes(reply) {
  const unverifiable = [];
  const spans = [];

  // Curly quotes always pair unambiguously: each “ is closed by the next ”.
  const curlyRe = /“([^“”]*)”/g;
  let m;
  while ((m = curlyRe.exec(reply))) {
    spans.push(m[1]);
  }

  const straightCount = (reply.match(/"/g) ?? []).length;
  if (straightCount % 2 !== 0) {
    unverifiable.push('unbalanced quote delimiters');
  } else {
    const straightRe = /"([^"]*)"/g;
    while ((m = straightRe.exec(reply))) {
      spans.push(m[1]);
    }
  }

  const quotes = spans
    .map((q) => q.trim())
    .filter((q) => q.split(/\s+/).filter(Boolean).length >= MIN_QUOTE_WORDS);

  return { quotes, unverifiable };
}

export function verifyQuotes(reply, chunks, { maxQuoteChars = Infinity } = {}) {
  const { quotes, unverifiable } = extractQuotes(reply);

  if (quotes.length === 0) {
    return { ok: unverifiable.length === 0, fabricated: [], overlong: [], unverifiable };
  }

  const haystack = chunks.map((c) => normalise(c.text)).join('\n');
  const fabricated = quotes.filter((q) => {
    const needle = normalise(q).replace(/[.,;:!?]+$/, '');
    return !haystack.includes(needle);
  });
  const overlong = quotes.filter((q) => normalise(q).length > maxQuoteChars);

  return {
    ok: fabricated.length === 0 && overlong.length === 0 && unverifiable.length === 0,
    fabricated,
    overlong,
    unverifiable,
  };
}
