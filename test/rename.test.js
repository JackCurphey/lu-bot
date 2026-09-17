import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMemberRename, matchesMemberName, RENAME_LINES } from '../src/rename.js';

const ctx = (over = {}) => ({
  mentions: [{ id: 'u-sam', name: 'sam' }, { id: 'lu', name: 'Lu' }],
  authorId: 'u-jack', authorName: 'jack', luId: 'lu', ...over,
});

// --- Recognising a request --------------------------------------------------------

test('rename @mention to a name', () => {
  assert.deepEqual(parseMemberRename('lu rename @sam to potato', ctx()), {
    target: { id: 'u-sam', name: 'sam' }, name: 'potato', reset: false,
  });
});

test('rename a typed name to a name, with "as"', () => {
  assert.deepEqual(parseMemberRename('lu rename dave as Big Dave', ctx()), {
    target: { typed: 'dave' }, name: 'Big Dave', reset: false,
  });
});

test('rename with no new name leaves the name to Lu', () => {
  assert.deepEqual(parseMemberRename('lu rename @sam', ctx()), {
    target: { id: 'u-sam', name: 'sam' }, name: null, reset: false,
  });
});

test("change someone's nickname to a name", () => {
  assert.deepEqual(parseMemberRename("lu change dave's nickname to the waverer", ctx()), {
    target: { typed: 'dave' }, name: 'the waverer', reset: false,
  });
});

test("set @mention's name, and a multi-word mention name", () => {
  const c = ctx({ mentions: [{ id: 'u-bs', name: 'big sam' }] });
  assert.deepEqual(parseMemberRename("set @big sam's nick to tiny sam", c), {
    target: { id: 'u-bs', name: 'big sam' }, name: 'tiny sam', reset: false,
  });
});

test('give someone a new name leaves the name to Lu', () => {
  assert.deepEqual(parseMemberRename('lu give @sam a new name', ctx()), {
    target: { id: 'u-sam', name: 'sam' }, name: null, reset: false,
  });
  assert.deepEqual(parseMemberRename('lu give dave a nickname', ctx()), {
    target: { typed: 'dave' }, name: null, reset: false,
  });
});

test("reset someone's name, or change it back", () => {
  const expected = { target: { typed: 'dave' }, name: null, reset: true };
  assert.deepEqual(parseMemberRename("lu reset dave's name", ctx()), expected);
  assert.deepEqual(parseMemberRename("lu change dave's name back", ctx()), expected);
});

test('"my" means the person asking', () => {
  assert.deepEqual(parseMemberRename('lu change my name to comrade jack', ctx()), {
    target: { id: 'u-jack', name: 'jack' }, name: 'comrade jack', reset: false,
  });
});

test('naming Lu as the target renames Lu', () => {
  assert.deepEqual(parseMemberRename('rename @Lu to chairman', ctx()), {
    target: { id: 'lu', name: 'Lu' }, name: 'chairman', reset: false,
  });
  assert.deepEqual(parseMemberRename('lu rename lu to chairman', ctx()), {
    target: { id: 'lu', name: 'Lu' }, name: 'chairman', reset: false,
  });
});

test('the new name stops at the end of the line', () => {
  assert.equal(parseMemberRename('lu rename @sam to potato\nand be quick', ctx()).name, 'potato');
});

// --- Leaving other messages alone ---------------------------------------------------

test('renaming Lu himself stays on the existing path', () => {
  for (const text of ['lu change your name to bob', 'rename yourself bob', 'lu change your nickname back']) {
    assert.equal(parseMemberRename(text, ctx()), null, text);
  }
});

test('ordinary chat that happens to use these words is not a rename', () => {
  for (const text of [
    'i need to rename this file',
    'did you change the name of the channel',
    'give it a name already',
    'can you give me a hand',
    "i'll change his name to something",
    'rename them to whatever',
    'what should i name my dog',
  ]) {
    assert.equal(parseMemberRename(text, ctx()), null, text);
  }
});

// --- Matching a typed name against a member -----------------------------------------

test('a typed name matches display name, nickname, username or global name, ignoring case', () => {
  const member = { displayName: 'Dave the Rave', nickname: 'Dave the Rave', username: 'dave99', globalName: 'Dave' };
  assert.equal(matchesMemberName(member, 'dave'), true);
  assert.equal(matchesMemberName(member, 'DAVE99'), true);
  assert.equal(matchesMemberName(member, 'dave the rave'), true);
  assert.equal(matchesMemberName(member, 'dav'), false, 'a prefix is not a match');
  assert.equal(matchesMemberName({ displayName: 'x', nickname: null, username: 'y', globalName: null }, 'null'), false);
});

test('every refusal has an in-character line', () => {
  for (const key of ['targetUnknown', 'targetAmbiguous', 'outranked', 'refused', 'mentions', 'tooLong']) {
    assert.equal(typeof RENAME_LINES[key], 'function', key);
    assert.ok(RENAME_LINES[key]('dave').length > 0, key);
  }
});
