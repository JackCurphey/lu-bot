// test/quotes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyQuotes } from '../src/quotes.js';

const chunks = [
  { text: 'Political power grows out of the barrel of a gun. That is the lesson.' },
  { text: 'The philosophers have only interpreted the world, in various ways.' },
];

test('a genuine quote passes', () => {
  const reply = 'As he put it, "Political power grows out of the barrel of a gun."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
});

test('a quote longer than maxQuoteChars is rejected', () => {
  const long = [{ text: `x ${'word '.repeat(100)}y` }];
  const reply = `He wrote, "${'word '.repeat(100).trim()}"`;
  const result = verifyQuotes(reply, long, { maxQuoteChars: 50 });
  assert.equal(result.ok, false);
  assert.equal(result.overlong.length, 1);
});

test('a fabricated quote is caught', () => {
  const reply = 'He famously wrote, "The revolution begins in the heart of the worker."';
  const result = verifyQuotes(reply, chunks);

  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
});

test('whitespace and curly quotes do not cause false failures', () => {
  const reply = 'He said, “Political  power   grows out of\nthe barrel of a gun”.';
  assert.equal(verifyQuotes(reply, chunks).ok, true);
});

test('short quoted phrases are ignored as emphasis', () => {
  const reply = 'The so-called "barrel of a gun" idea is often misread.';
  assert.equal(verifyQuotes(reply, chunks).ok, true);
});

test('a reply with no quotes passes trivially', () => {
  const result = verifyQuotes('Just talking, no citation here.', chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
});

test('any quote fails when no chunks were supplied', () => {
  const reply = 'He wrote, "Political power grows out of the barrel of a gun."';
  assert.equal(verifyQuotes(reply, []).ok, false);
});

test('a stray straight quote earlier in the reply does not hide a fabricated citation', () => {
  const reply =
    'He measured the board at 6" then added, "The revolution begins in the heart of the worker."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('a curly-quoted span followed by a stray straight quote is still unverifiable', () => {
  const reply =
    'He said, “Political power grows out of the barrel of a gun” and the board measured 6".';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('a reply with balanced quotes still passes normally', () => {
  const reply = 'As he put it, "Political power grows out of the barrel of a gun."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unverifiable, []);
});

test('overlong is measured on the normalised quote, not the raw whitespace-padded one', () => {
  const reply =
    'He said, "Political   power    grows   out   of\n\n\nthe   barrel   of   a   gun."';
  const result = verifyQuotes(reply, chunks, { maxQuoteChars: 55 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.overlong, []);
  assert.deepEqual(result.fabricated, []);
});

// --- Round 2: even-count stray straight quotes must not hide a fabrication ---
//
// The round-1 fix only failed closed when the total straight-quote count
// was odd. With an even count of stray quotes straddling a genuine quoted
// span, the old alternating-pair regex could still pair delimiters across
// the stray quotes and miss the fabricated sentence entirely. These tests
// cover the controller's ruling: q===2 stays unambiguous, q>=4 even is
// ambiguous and must be checked segment-by-segment.

test('an even count of stray straight quotes does not hide a fabricated citation', () => {
  // Four straight quotes total: 6" ... "fabricated quote" ... 9". The old
  // alternating-pair regex paired (6" <-> first ") and (second " <-> 9"),
  // both yielding short filler that got filtered, so the fabricated
  // sentence between them was never extracted at all.
  const reply =
    'He measured it at 6" then claimed, "The revolution begins in the heart of the worker" oddly 9" tall.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('an odd count of stray straight quotes plus a fabricated quote is still caught', () => {
  const reply =
    'He measured the board at 6" then added, "The revolution begins in the heart of the worker."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('four straight quotes bounding two genuine spans with short connecting prose still passes', () => {
  const reply =
    'He said, "Political power grows out of the barrel of a gun" then ' +
    '"The philosophers have only interpreted the world, in various ways."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
  assert.deepEqual(result.unverifiable, []);
});

test('a single genuine straight-quoted span (q === 2) still passes', () => {
  const reply = 'As he put it, "Political power grows out of the barrel of a gun."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
  assert.deepEqual(result.unverifiable, []);
});

test('a single fabricated straight-quoted span (q === 2) lands in fabricated, not unverifiable', () => {
  const reply = 'He famously wrote, "The revolution begins in the heart of the worker."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
  assert.deepEqual(result.unverifiable, []);
});

// --- Round 3: non-ASCII/non-curly quotation-mark delimiters ---
//
// Lu Bot's persona and corpus (Marx, Mao) make CJK punctuation like 「」
// and 『』 the expected shape of a real quoted citation, not an exotic
// edge case. verifyQuotes previously only recognised ASCII straight `"`
// and curly “ ” as delimiters, so a fabricated quote wrapped in any other
// quotation-mark style passed through unchecked. Fullwidth `＂` (U+FF02)
// and the CJK/guillemet pairs below must now be recognised.

test('a fabricated quote in fullwidth quotation marks (＂ ＂) is caught', () => {
  const reply = 'He famously wrote, ＂The revolution begins in the heart of the worker＂.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
});

test('a fabricated quote in Chinese corner brackets (「 」) is caught', () => {
  const reply = 'He famously wrote, 「The revolution begins in the heart of the worker」.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
});

test('a fabricated quote in Chinese white corner brackets (『 』) is caught', () => {
  const reply = 'He famously wrote, 『The revolution begins in the heart of the worker』.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
});

test('a fabricated quote in guillemets (« ») is caught', () => {
  const reply = 'He famously wrote, «The revolution begins in the heart of the worker».';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
});

test('a genuine quote inside Chinese corner brackets (「 」) passes', () => {
  const reply = '「Political power grows out of the barrel of a gun.」';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
});

test('an apostrophe in ordinary prose does not get treated as a delimiter', () => {
  const reply = "It's the workers' struggle that decides everything in the end, he said.";
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
});

test('the round-2 even-count straight-quote evasion is still caught', () => {
  const reply =
    'He measured it at 6" then claimed, "The revolution begins in the heart of the worker" oddly 9" tall.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('a single genuine ASCII-quoted passage still passes', () => {
  const reply = 'As he put it, "Political power grows out of the barrel of a gun."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
});

// --- Round 4: unpaired opening/closing delimiters must fail closed ---
//
// The straight-quote path already fails closed on an unbalanced delimiter
// count. The distinct-pair styles (“ ”, 「 」, 『 』, « ») did not: an
// opening delimiter with no closing partner simply produced no candidate
// span, so an uncited fabricated passage sailed through with ok: true.
// Truncated model generations (token limit hit mid-quotation) produce
// exactly this shape. Counting openers against closers per style is
// enough — a mismatch either way means the reply cannot be parsed
// unambiguously and must be rejected rather than guessed at.

test('an unpaired opening corner bracket (「) is rejected', () => {
  const reply = 'He wrote 「The revolution begins in the heart of the worker';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('a lone unpaired closing corner bracket (」) is rejected', () => {
  const reply = 'The revolution begins in the heart of the worker」 he wrote';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('an unpaired opening curly double quote (“) is rejected', () => {
  const reply = 'He wrote “The revolution begins in the heart of the worker';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('an unpaired guillemet («) is rejected', () => {
  const reply = 'He wrote «The revolution begins in the heart of the worker';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('an unpaired white corner bracket (『) is rejected', () => {
  const reply = 'He wrote 『The revolution begins in the heart of the worker';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('two correctly paired 「」 spans in one reply, both genuine, pass', () => {
  const reply =
    'He said 「Political power grows out of the barrel of a gun.」 and later ' +
    '「The philosophers have only interpreted the world, in various ways.」';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
  assert.deepEqual(result.unverifiable, []);
});

test('a correctly paired 「」 span records no unverifiable reason', () => {
  const reply = 'He said 「Political power grows out of the barrel of a gun.」';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unverifiable, []);
});

test('ordinary prose with apostrophes records no unverifiable reason', () => {
  const reply = "It's the workers' struggle that decides everything in the end, he said.";
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unverifiable, []);
});

// --- Round 5: the unpaired-delimiter rule must be scoped to unmatched text ---
//
// Round 4 counted openers against closers across the whole reply, so a
// single unrelated delimiter character elsewhere — a guillemet used as a
// comparison operator, an arrow-like » in a footnote — rejected an
// otherwise genuine, correctly paired, verbatim citation. Silence is a
// failure mode too: a verifier that mutes legitimate replies looks like a
// bot with nothing to say rather than a bot with a bug. The counting is
// now done only over the text left after the properly-paired spans are
// removed, so a stray delimiter still fails closed but a matched pair no
// longer counts against the reply.

test('a stray guillemet used as a comparison operator does not reject a genuine paired quote', () => {
  const reply =
    'He said «Political power grows out of the barrel of a gun.» Also, 5 « 10 in that notation.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
  assert.deepEqual(result.unverifiable, []);
});

test('a stray » in a footnote does not reject a genuine curly-quoted citation', () => {
  const reply =
    'He said “Political power grows out of the barrel of a gun.” See details » here.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
  assert.deepEqual(result.unverifiable, []);
});

test('a paired but fabricated 「」 span is still caught as fabricated, not unverifiable', () => {
  const reply = 'He wrote 「The revolution begins in the heart of the worker」';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /revolution begins/);
  assert.deepEqual(result.unverifiable, []);
});

test('a conversational reply with no quotes and an empty chunk array passes', () => {
  const result = verifyQuotes('Just talking, no citation here.', []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
  assert.deepEqual(result.overlong, []);
  assert.deepEqual(result.unverifiable, []);
});

// --- Controller adjudication: the length floor must be script-aware ---
//
// MIN_QUOTE_WORDS splits on whitespace. Chinese does not put spaces between
// words, so an entire Chinese quotation of any length counted as one "word"
// and never met the floor — meaning it was never fabrication-checked, and
// never counted as enough unaccounted text to trip the unpaired-delimiter
// guard. The verifier was inert in exactly the language a fabricated
// quotation from a Marx/Mao corpus is most likely to arrive in, and 「」 are
// Chinese quotation marks. The floor is now met by either five
// whitespace-separated tokens or MIN_QUOTE_CJK_CHARS (8) CJK codepoints.

const CN_FABRICATION = '政治权力从枪杆子中产生，革命始于工人之心';

test('a paired 「」 Chinese fabrication is caught', () => {
  const reply = `他说：「${CN_FABRICATION}」`;
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /革命始于工人之心/);
});

test('an unpaired 「 before a Chinese fabrication is not silently ignored', () => {
  const reply = `他说：「${CN_FABRICATION}`;
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
});

test('a Chinese fabrication in ASCII straight quotes is caught', () => {
  const reply = `He wrote "${CN_FABRICATION}"`;
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /革命始于工人之心/);
});

test('a Chinese fabrication in curly quotes is caught', () => {
  const reply = `He wrote “${CN_FABRICATION}”`;
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.equal(result.fabricated.length, 1);
  assert.match(result.fabricated[0], /革命始于工人之心/);
});

test('a short Chinese phrase used as emphasis is still ignored', () => {
  // 实事求是 is four CJK characters — below MIN_QUOTE_CJK_CHARS, so it is
  // ordinary emphasis, not a citation. The bot must not be muted by it.
  const reply = '他所谓的「实事求是」正是这个道理。';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.fabricated, []);
  assert.deepEqual(result.unverifiable, []);
});

// --- Whole-branch review, finding A: attribution without any delimiter ---
//
// Five review rounds hardened delimiter *pairing* on the unstated assumption
// that a delimiter is present at all. Nothing required the model to use one.
// Every string below was verified reaching the channel with ok: true.
//
// A1 closes the missing delimiter pairs (【】, ﹁﹂, 〈〉) and the reversed
// balanced pair (a closing mark appearing before its opener, where the counts
// balance so the mismatch branch never ran).
//
// A2 rejects attribution-shaped output carrying no delimiter at all.

test('A1: a fabricated quote in lenticular brackets (【 】) is caught', () => {
  const reply = 'He wrote 【a fabricated line about the dictatorship of the proletariat】';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
});

test('A1: a fabricated quote in vertical corner brackets (﹁ ﹂) is caught', () => {
  const reply = 'He wrote ﹁The revolution begins in the heart of the worker﹂';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
});

test('A1: a fabricated quote in angle brackets (〈 〉) is caught', () => {
  const reply = 'He wrote 〈The revolution begins in the heart of the worker〉';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
});

test('A1: a reversed but balanced 」…「 pair is unverifiable, not invisible', () => {
  const reply = 'He wrote 」The revolution begins in the heart of the worker「';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.length > 0, 'expected unverifiable reasons to be recorded');
});

test('A1: a reversed but balanced 》…《 pair is unverifiable', () => {
  const reply = 'He wrote 》The revolution begins in the heart of the worker《';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
});

test('A1: a reversed but balanced »…« pair is unverifiable', () => {
  const reply = 'He wrote »The revolution begins in the heart of the worker«';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
});

test('A2: an attribution cue with a colon and no delimiter is rejected', () => {
  const reply =
    'As Mao wrote in On Practice: all genuine knowledge originates in direct experience of the class struggle.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.includes('attribution without quotation marks'));
});

test('A2: a Discord blockquote carrying an undelimited citation is rejected', () => {
  const reply = 'Mao put it plainly:\n\n> The revolution begins in the heart of every worker.';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.includes('attribution without quotation marks'));
});

test('A2: a bold-marked undelimited citation is rejected', () => {
  const reply = 'Marx said it best: **The philosophers have merely invented this sentence.**';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.includes('attribution without quotation marks'));
});

test('A2: single curly quotes after an attribution cue are rejected', () => {
  const reply = 'Mao told us, ‘the masses are the makers of every revolution in history’';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.includes('attribution without quotation marks'));
});

test('A2: a Chinese attribution with a fullwidth colon and no delimiter is rejected', () => {
  const reply = '毛主席说过：革命不是请客吃饭，不是做文章。';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, false);
  assert.ok(result.unverifiable.includes('attribution without quotation marks'));
});

test('A2: a colon with no attribution cue is ordinary conversation and passes', () => {
  const result = verifyQuotes('Here is the thing: I disagree.', chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unverifiable, []);
});

test('A2: a correctly delimited genuine quotation with an attribution cue passes', () => {
  const reply = 'He wrote, "Political power grows out of the barrel of a gun."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unverifiable, []);
});

test('A2: a short reply with no colon at all passes', () => {
  const result = verifyQuotes('He said so himself, comrade.', chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unverifiable, []);
});

test('A2: a blockquote whose content is properly delimited is not flagged', () => {
  const reply = '> "Political power grows out of the barrel of a gun."';
  const result = verifyQuotes(reply, chunks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unverifiable, []);
});
