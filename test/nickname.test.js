import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NICKNAME_MAX_LENGTH, NICKNAME_REQUEST_RE, NICKNAME_INSTRUCTION,
  extractNickname, validateNickname, NICKNAME_LINES,
} from '../src/nickname.js';

// Note: "go by Bob from now on" (with no leading "you") intentionally does
// NOT match any more — see "the bare 'go by' alternative only matches when
// addressed to Lu" below. This phrasing list uses "you go by" instead.

// --- Request detection ----------------------------------------------------

test('detects several rename phrasings', () => {
  const phrasings = [
    'change your name to Bob',
    'change your nick to Bob',
    'change your nickname to Bob',
    'call yourself Bob',
    'you go by Bob from now on',
    'rename yourself Bob',
    'set your name to Bob',
    'set your nick to Bob',
    'your name is now Bob',
    'go back to your normal name',
    'go back to your default name',
    'go back to your old name',
    'go back to your real name',
    'reset your name',
    'reset your nick',
    'reset your nickname',
  ];
  for (const p of phrasings) {
    assert.match(p, NICKNAME_REQUEST_RE, `expected to match: "${p}"`);
  }
});

test('a rename request is detected anywhere in a longer message', () => {
  assert.match('hey lu, could you please change your name to Bob thanks', NICKNAME_REQUEST_RE);
});

test('does not match unrelated messages', () => {
  const notRequests = [
    'what is your name',
    'change the channel name',
    'what is your nickname anyway',
    'i like your name',
  ];
  for (const m of notRequests) {
    assert.doesNotMatch(m, NICKNAME_REQUEST_RE, `expected NOT to match: "${m}"`);
  }
});

// --- Fix round 1, Minor 4: "go by" must be addressed to Lu ------------------

test('the bare "go by" alternative only matches when addressed to Lu', () => {
  assert.doesNotMatch('i go by jack', NICKNAME_REQUEST_RE);
  assert.doesNotMatch('most people go by their middle name', NICKNAME_REQUEST_RE);
  assert.match('you go by Bob now', NICKNAME_REQUEST_RE);
});

test('NICKNAME_INSTRUCTION is under 900 characters', () => {
  assert.ok(NICKNAME_INSTRUCTION.length < 900, `got ${NICKNAME_INSTRUCTION.length}`);
});

test('NICKNAME_INSTRUCTION explains the marker format and RESET', () => {
  assert.match(NICKNAME_INSTRUCTION, /NICKNAME:/);
  assert.match(NICKNAME_INSTRUCTION, /RESET/);
});

// --- Extraction ------------------------------------------------------------

test('extractNickname removes the marker line and preserves the rest of the reply', () => {
  const out = extractNickname('sure comrade\nNICKNAME: Bob\nglad to help');
  assert.equal(out.text, 'sure comrade\nglad to help');
  assert.deepEqual(out.request, { name: 'Bob' });
});

test('extractNickname recognises RESET case-insensitively', () => {
  assert.deepEqual(extractNickname('ok\nNICKNAME: reset').request, { reset: true });
  assert.deepEqual(extractNickname('ok\nNICKNAME: RESET').request, { reset: true });
});

test('extractNickname returns request null when there is no marker', () => {
  const out = extractNickname('just a normal reply');
  assert.equal(out.text, 'just a normal reply');
  assert.equal(out.request, null);
});

test('extractNickname does not match a marker that is not on its own line', () => {
  const out = extractNickname('I will not do NICKNAME: Bob today');
  assert.equal(out.request, null);
  assert.equal(out.text, 'I will not do NICKNAME: Bob today');
});

// --- Fix round 1, Important 1: every marker line must be stripped ----------

test('extractNickname strips every marker line but takes only the first as the request', () => {
  const out = extractNickname('NICKNAME: Bob\nNICKNAME: Carl');
  assert.deepEqual(out.request, { name: 'Bob' });
  assert.equal(out.text, '');
});

test('extractNickname strips a repeated marker line with other text around it', () => {
  const out = extractNickname('hi\nNICKNAME: Bob\nmore text\nNICKNAME: Carl\nbye');
  assert.deepEqual(out.request, { name: 'Bob' });
  assert.equal(out.text, 'hi\nmore text\nbye');
});

// --- Fix round 1, Important 2: a decorated marker must still be found ------

test('a bold-decorated marker is removed from the text and recognised with the clean name', () => {
  const out = extractNickname('sure comrade\n**NICKNAME: Bob**\nglad to help');
  assert.deepEqual(out.request, { name: 'Bob' });
  assert.equal(out.text, 'sure comrade\nglad to help');
});

test('a bullet-decorated marker is removed from the text and recognised with the clean name', () => {
  const out = extractNickname('sure comrade\n- NICKNAME: Bob\nglad to help');
  assert.deepEqual(out.request, { name: 'Bob' });
  assert.equal(out.text, 'sure comrade\nglad to help');
});

test('a quote-block-decorated marker is removed from the text and recognised with the clean name', () => {
  const out = extractNickname('sure comrade\n> NICKNAME: Bob\nglad to help');
  assert.deepEqual(out.request, { name: 'Bob' });
  assert.equal(out.text, 'sure comrade\nglad to help');
});

// --- Validation --------------------------------------------------------------

test('a 32-character name is ok', () => {
  const name = 'a'.repeat(NICKNAME_MAX_LENGTH);
  assert.deepEqual(validateNickname(name), { ok: true, name });
});

test('a 33-character name is too-long', () => {
  const out = validateNickname('a'.repeat(NICKNAME_MAX_LENGTH + 1));
  assert.deepEqual(out, { ok: false, reason: 'too-long' });
});

test('@everyone is rejected as mentions', () => {
  assert.deepEqual(validateNickname('@everyone'), { ok: false, reason: 'mentions' });
});

test('@here is rejected as mentions', () => {
  assert.deepEqual(validateNickname('@here'), { ok: false, reason: 'mentions' });
});

test('a user mention tag is rejected as mentions', () => {
  assert.deepEqual(validateNickname('hey <@123456>'), { ok: false, reason: 'mentions' });
});

test('markdown characters are stripped', () => {
  assert.deepEqual(validateNickname('*Bob*_the_~great~'), { ok: true, name: 'Bobthegreat' });
});

// --- Fix round 1, Minor 5: quotes are stripped too --------------------------

test('straight double quotes are stripped', () => {
  assert.deepEqual(validateNickname('"Bob"'), { ok: true, name: 'Bob' });
});

test('curly double quotes are stripped', () => {
  assert.deepEqual(validateNickname('“Bob”'), { ok: true, name: 'Bob' });
});

test('an empty name is rejected', () => {
  assert.deepEqual(validateNickname('   '), { ok: false, reason: 'empty' });
});

test('a name that is only markdown characters is rejected as empty after stripping', () => {
  assert.deepEqual(validateNickname('***'), { ok: false, reason: 'empty' });
});

test('NICKNAME_LINES carries the exact in-character status lines', () => {
  assert.deepEqual(NICKNAME_LINES, {
    noPermission: 'you need the manage nicknames permission to tell me that comrade',
    notInGuild: 'i can only change my name inside a server',
    tooLong: 'thats too long, discord stops me at 32 characters',
    mentions: 'i will not put a mention in my own name',
    refused: 'the server will not let me change my own name, someone give me the change nickname permission',
  });
});
