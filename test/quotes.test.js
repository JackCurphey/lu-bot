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
