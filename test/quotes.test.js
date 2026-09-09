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
