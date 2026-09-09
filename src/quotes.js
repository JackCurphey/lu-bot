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

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Extracts quoted spans. Curly quotes always pair unambiguously: each “ is
// closed by the next ”, so a curly span is checked directly against the
// haystack.
//
// Straight double quotes cannot be paired by inference — trying to guess
// which " opens a quote and which closes it is exactly the bug this
// function used to have (a stray straight quote, e.g. a measurement like
// 6", could shift the pairing and hide a fabricated quote in the
// resulting mis-paired span). Instead:
//   - 0 straight quotes: no straight-quote candidates.
//   - odd count: the delimiters themselves are unbalanced; report
//     unverifiable and do not attempt to extract a span.
//   - exactly 2: only one possible span, unambiguous, checked normally.
//   - >=4 and even: pairing is genuinely ambiguous. Every segment bounded
//     by quote characters on both sides (all consecutive gaps between "
//     occurrences, not just alternating ones) is a candidate that could be
//     quoted content. These are returned separately as ambiguousCandidates
//     so the caller can fail closed (unverifiable) if any candidate of
//     substantial length is missing from the haystack, without asserting
//     it is definitely a fabrication (we don't know it was really meant
//     as a quote).
function extractQuotes(reply) {
  const unverifiable = [];
  const spans = [];
  const ambiguousSpans = [];

  // Curly quotes always pair unambiguously: each “ is closed by the next ”.
  const curlyRe = /“([^“”]*)”/g;
  let m;
  while ((m = curlyRe.exec(reply))) {
    spans.push(m[1]);
  }

  const positions = [];
  const straightRe = /"/g;
  while ((m = straightRe.exec(reply))) {
    positions.push(m.index);
  }
  const q = positions.length;

  if (q % 2 !== 0) {
    unverifiable.push('unbalanced quote delimiters');
  } else if (q === 2) {
    spans.push(reply.slice(positions[0] + 1, positions[1]));
  } else if (q >= 4) {
    for (let i = 0; i < positions.length - 1; i++) {
      ambiguousSpans.push(reply.slice(positions[i] + 1, positions[i + 1]));
    }
  }

  const quotes = spans.map((s) => s.trim()).filter((s) => wordCount(s) >= MIN_QUOTE_WORDS);
  const ambiguousCandidates = ambiguousSpans
    .map((s) => s.trim())
    .filter((s) => wordCount(s) >= MIN_QUOTE_WORDS);

  return { quotes, unverifiable, ambiguousCandidates };
}

export function verifyQuotes(reply, chunks, { maxQuoteChars = Infinity } = {}) {
  const { quotes, unverifiable, ambiguousCandidates } = extractQuotes(reply);

  const haystack = chunks.map((c) => normalise(c.text)).join('\n');
  const isMissing = (q) => {
    const needle = normalise(q).replace(/[.,;:!?]+$/, '');
    return !haystack.includes(needle);
  };

  const fabricated = quotes.filter(isMissing);
  const overlong = quotes.filter((q) => normalise(q).length > maxQuoteChars);

  const allUnverifiable = [...unverifiable];
  if (ambiguousCandidates.some(isMissing)) {
    allUnverifiable.push('ambiguous quote delimiters');
  }

  return {
    ok: fabricated.length === 0 && overlong.length === 0 && allUnverifiable.length === 0,
    fabricated,
    overlong,
    unverifiable: allUnverifiable,
  };
}
