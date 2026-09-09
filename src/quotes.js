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

// Delimiter pairs whose opening and closing characters are distinct, so
// pairing is never in doubt — unlike a symmetric delimiter (the same
// character both opens and closes), these can be matched directly with a
// non-greedy regex the way curly quotes always have been. Deliberately
// excludes ‘ ’ (single curly quotes), which double as apostrophes in
// ordinary English and would produce constant false positives.
//
// Each entry carries its opening and closing characters as well as the
// span regex, so that after extracting the properly-paired spans we can
// also detect an *unpaired* delimiter of that style (see below).
const UNAMBIGUOUS_PAIRS = [
  { open: '“', close: '”', re: /“([^“”]*)”/g }, // curly double quotes
  { open: '「', close: '」', re: /「([^「」]*)」/g }, // Chinese/Japanese quotation marks
  { open: '『', close: '』', re: /『([^『』]*)』/g }, // Chinese/Japanese book/nested marks
  { open: '«', close: '»', re: /«([^«»]*)»/g }, // guillemets
];

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}

// True when an unmatched delimiter of this style could be concealing a
// citation — i.e. the run of text on the side where the quoted passage
// would live is long enough to be a quote at all (MIN_QUOTE_WORDS).
//
// An unmatched opener's content would run forwards from it; an unmatched
// closer's runs backwards. The run stops at the next delimiter of the same
// style in either direction. Anything shorter than the minimum quote length
// is below the threshold this module checks anywhere else, so there is
// nothing a fabrication could be hiding in and no reason to fail closed.
function unmatchedCouldHideQuote(residue, open, close, direction) {
  const target = direction === 'forward' ? open : close;
  for (let i = 0; i < residue.length; i++) {
    if (residue[i] !== target) continue;
    let run;
    if (direction === 'forward') {
      let j = i + 1;
      while (j < residue.length && residue[j] !== open && residue[j] !== close) j += 1;
      run = residue.slice(i + 1, j);
    } else {
      let j = i - 1;
      while (j >= 0 && residue[j] !== open && residue[j] !== close) j -= 1;
      run = residue.slice(j + 1, i);
    }
    if (wordCount(run) >= MIN_QUOTE_WORDS) return true;
  }
  return false;
}

// Extracts quoted spans.
//
// Unambiguous paired delimiters (see UNAMBIGUOUS_PAIR_RES above) are
// checked directly against the haystack, same as curly quotes always were.
//
// Symmetric delimiters — where the same character opens and closes —
// cannot be paired by inference: trying to guess which occurrence opens a
// quote and which closes it is exactly the bug this function used to have
// (a stray straight quote, e.g. a measurement like 6", could shift the
// pairing and hide a fabricated quote in the resulting mis-paired span).
// Currently only `"` is treated this way; the fullwidth `＂` (U+FF02) is
// normalised to `"` up front so it inherits this same handling rather than
// duplicating the pairing logic. Rules:
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

  let m;

  // The shared residue: the reply with every properly-paired span of every
  // unambiguous style removed. The unpaired-delimiter check below runs
  // against this rather than against the whole reply. It is shared across
  // styles on purpose — a « in a reply that also contains a paired “ ” span
  // must not be judged against the curly-quoted text, which is already
  // accounted for by its own span.
  let residue = reply;
  for (const { re } of UNAMBIGUOUS_PAIRS) {
    re.lastIndex = 0;
    residue = residue.replace(re, ' ');
  }

  for (const { open, close, re } of UNAMBIGUOUS_PAIRS) {
    re.lastIndex = 0;
    while ((m = re.exec(reply))) {
      spans.push(m[1]);
    }
    // An unpaired opener or closer means the reply cannot be parsed
    // unambiguously: with an opening delimiter and no closing partner the
    // quoted passage produces no candidate span at all, so a fabrication
    // would sail through unchecked (a truncated generation that hits the
    // token limit mid-quotation has exactly this shape). The straight-quote
    // path already fails closed on an unbalanced count; these styles do the
    // same. We do not guess where the missing delimiter belongs.
    //
    // The count is deliberately taken over the *residue* — the reply with
    // every properly-paired span of this style removed — not over the whole
    // reply. Counting the whole reply rejected genuine, correctly paired,
    // verbatim citations whenever one unrelated delimiter character appeared
    // anywhere else (a guillemet used as a comparison operator, an
    // arrow-like » in a footnote). Silence is a failure mode too: a verifier
    // that mutes legitimate replies is harder to notice than one that lets a
    // fabrication through, because it just looks like a bot with nothing to
    // say. Scoping the count keeps the fail-closed rule exactly where it
    // earns its keep — a delimiter that never found a partner, with enough
    // unaccounted text beside it to be concealing a quotation — while a
    // delimiter that did pair up no longer counts against the reply.
    const opens = countChar(residue, open);
    const closes = countChar(residue, close);
    if (opens !== closes) {
      const direction = opens > closes ? 'forward' : 'backward';
      if (unmatchedCouldHideQuote(residue, open, close, direction)) {
        unverifiable.push('unpaired quote delimiter');
      }
    }
  }

  // Normalise fullwidth double quote to the ASCII straight quote so it
  // inherits the odd/even ambiguity handling below without a second copy
  // of the pairing logic.
  const straightReply = reply.replace(/＂/g, '"');

  const positions = [];
  const straightRe = /"/g;
  while ((m = straightRe.exec(straightReply))) {
    positions.push(m.index);
  }
  const q = positions.length;

  if (q % 2 !== 0) {
    unverifiable.push('unbalanced quote delimiters');
  } else if (q === 2) {
    spans.push(straightReply.slice(positions[0] + 1, positions[1]));
  } else if (q >= 4) {
    for (let i = 0; i < positions.length - 1; i++) {
      ambiguousSpans.push(straightReply.slice(positions[i] + 1, positions[i + 1]));
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
