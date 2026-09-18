// test/suggestions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseSuggestion, formatEntry, appendSuggestion, SUGGESTION_LINES,
} from '../src/suggestions.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'lubot-sugg-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// --- Recognising a suggestion -----------------------------------------------

test('"lu suggest" with a colon captures the body', () => {
  assert.deepEqual(parseSuggestion('lu suggest: let people vote on the music'), {
    text: 'let people vote on the music',
  });
});

test('"lu suggestion" without punctuation captures the body', () => {
  assert.deepEqual(parseSuggestion('lu suggestion give everyone a daily quote'), {
    text: 'give everyone a daily quote',
  });
});

test('"lu idea" captures the body', () => {
  assert.deepEqual(parseSuggestion('lu idea - a command that rolls dice'), {
    text: 'a command that rolls dice',
  });
});

test('"lu feature request" captures the body', () => {
  assert.deepEqual(parseSuggestion('lu feature request: remember birthdays'), {
    text: 'remember birthdays',
  });
});

test('an optional "that" before the body is not part of the suggestion', () => {
  assert.deepEqual(parseSuggestion('lu suggest that you learn to play chess'), {
    text: 'you learn to play chess',
  });
});

test('the trigger is matched case-insensitively', () => {
  assert.deepEqual(parseSuggestion('LU SUGGEST: shout less'), { text: 'shout less' });
});

test('a mention of Lu counts as naming him', () => {
  assert.deepEqual(parseSuggestion('@Lu suggest: add a soundboard'), { text: 'add a soundboard' });
});

test('the body keeps its own newlines and is trimmed at both ends', () => {
  assert.deepEqual(parseSuggestion('lu suggest:   a two part idea\nsecond line   '), {
    text: 'a two part idea\nsecond line',
  });
});

test('an empty body is a suggestion with no text, not a capture', () => {
  assert.deepEqual(parseSuggestion('lu suggest:'), { text: '' });
});

// --- Not a suggestion -------------------------------------------------------

test('ordinary chat containing "suggest" is not a suggestion', () => {
  assert.equal(parseSuggestion('we should suggest a name for the channel'), null);
});

test('a suggestion word without Lu being named is not a suggestion', () => {
  assert.equal(parseSuggestion('suggest: someone make the tea'), null);
});

test('talking about someone else\'s idea is not a suggestion', () => {
  assert.equal(parseSuggestion('lu what do you think of daves idea'), null);
});

test('an empty message is not a suggestion', () => {
  assert.equal(parseSuggestion(''), null);
});

// --- The recorded line ------------------------------------------------------

const entryInput = {
  text: 'let people vote on the music',
  authorId: 'u-jack',
  authorName: 'jack',
  guildId: 'g-1',
  channelId: 'c-1',
  messageId: 'm-1',
  at: new Date('2026-09-18T10:30:00.000Z'),
};

test('an entry records who said what, where, and when', () => {
  assert.deepEqual(formatEntry(entryInput), {
    at: '2026-09-18T10:30:00.000Z',
    text: 'let people vote on the music',
    authorId: 'u-jack',
    authorName: 'jack',
    guildId: 'g-1',
    channelId: 'c-1',
    messageId: 'm-1',
    link: 'https://discord.com/channels/g-1/c-1/m-1',
  });
});

test('a direct message has no guild, so it has no jump link', () => {
  const entry = formatEntry({ ...entryInput, guildId: null });
  assert.equal(entry.guildId, null);
  assert.equal(entry.link, null);
});

// --- Writing the file -------------------------------------------------------

test('the first suggestion creates the file and its directory', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nested', 'suggestions.jsonl');
    await appendSuggestion({ path, entry: formatEntry(entryInput) });

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).text, 'let people vote on the music');
  });
});

test('a second suggestion is appended, not written over the first', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'suggestions.jsonl');
    await appendSuggestion({ path, entry: formatEntry(entryInput) });
    await appendSuggestion({ path, entry: formatEntry({ ...entryInput, text: 'second idea', messageId: 'm-2' }) });

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => JSON.parse(l).text), ['let people vote on the music', 'second idea']);
  });
});

test('a suggestion containing a newline still occupies exactly one line', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'suggestions.jsonl');
    await appendSuggestion({ path, entry: formatEntry({ ...entryInput, text: 'line one\nline two' }) });

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).text, 'line one\nline two');
  });
});

test('a write that fails rejects rather than reporting a capture that did not happen', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'locked', 'suggestions.jsonl');
    await writeFile(join(dir, 'locked'), 'not a directory');
    await assert.rejects(() => appendSuggestion({ path, entry: formatEntry(entryInput) }));
  });
});

// --- What Lu says -----------------------------------------------------------

test('the lines Lu says are in character and mention no internals', () => {
  for (const line of [SUGGESTION_LINES.noted(), SUGGESTION_LINES.empty(), SUGGESTION_LINES.failed()]) {
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0);
    assert.doesNotMatch(line, /jsonl|\.json|file|path|disk/i);
  }
});
